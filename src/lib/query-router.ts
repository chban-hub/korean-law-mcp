/**
 * Smart Query Router
 * 자연어 질의를 분석하여 최적의 도구/체인으로 라우팅
 *
 * 패턴 매칭 기반으로 의도를 파악하고, 필요한 파라미터를 자동 추출.
 * 패턴 테이블은 route-patterns.ts, 추출기는 query-extract.ts,
 * 시나리오 판정 어휘는 scenario-rules.ts (CLI·MCP 공통 원본).
 */

import { SEARCH_DETAIL_CHAINS } from "./tool-chain-config.js"
import { parseDateRange, stripMatchedDate, type DateRange } from "./date-parser.js"
import { sortedRoutePatterns, yieldsToOther, type Pattern } from "./route-patterns.js"
import { detectScenarioName } from "./scenario-rules.js"
import { wantsFullText } from "./query-extract.js"

export interface RouteResult {
  /** 실행할 도구 이름 */
  tool: string
  /** 매칭된 패턴 이름 (디버깅 — 어느 규칙이 이겼는지) */
  matchedPattern?: string
  /** 도구에 전달할 파라미터 */
  params: Record<string, unknown>
  /** 라우팅 근거 설명 */
  reason: string
  /** 후속 실행이 필요한 도구 (파이프라인) */
  pipeline?: Array<{ tool: string; params: Record<string, unknown> }>
  /** 자동 체인 여부 (search → detail 자동 연결) */
  autoChain?: boolean
  /** 자연어에서 추출된 날짜 범위 (검색 도구에 자동 적용) */
  dateRange?: DateRange
  /** 의도는 읽었으나 목적지 도구가 받지 않는 파라미터 — 무음 폐기 대신 표면화(#120) */
  unsupportedParams?: string[]
  /** 해석이 갈리는 질의에 대한 확인 요청 문구 (#122) */
  clarify?: string
}

/**
 * 자연어 질의를 분석하여 최적의 도구로 라우팅
 */
export function routeQuery(query: string): RouteResult {
  const q = query.trim()

  // 빈 쿼리
  if (!q) {
    return {
      tool: "search_all",
      params: { query: "" },
      reason: "빈 쿼리 → 통합검색",
    }
  }

  // 패턴 매칭은 원문 기준 — 날짜를 먼저 지우면 "최근 3년 이내 개정" 같은
  // 시점 패턴이 자기 트리거를 잃는다(#100)
  const result = _matchRoute(q)

  // 날짜 범위는 매칭 이후에 뽑아 결과에 첨부하고, 검색어에서만 시간 표현을 걷어낸다
  const dateParsed = parseDateRange(q)
  if (dateParsed.range) {
    result.dateRange = dateParsed.range
    if (typeof result.params.query === "string" && dateParsed.matched) {
      const cleaned = stripMatchedDate(result.params.query, dateParsed.matched)
      if (cleaned) result.params.query = cleaned
    }
  }

  // 시나리오는 단일 원본(scenario-rules)이 판정한다 — 라우터가 별도 규칙을 갖지 않으므로
  // CLI(params.scenario)와 MCP(chain 의 detectScenario)가 갈릴 수 없다(#101)
  if (result.tool.startsWith("chain_")) {
    const scenario = detectScenarioName(q, result.tool)
    if (scenario) result.params.scenario = scenario
  }

  // 빈 검색어는 업스트림에 보내지 않는다 — 트리거 어휘가 곧 질의 전부인 경우의 마지막 방어(#119)
  if (typeof result.params.query === "string" && !result.params.query.trim()) {
    result.params.query = q
  }

  return result
}

/** 패턴 매칭 내부 함수 (routeQuery에서만 호출) */
function _matchRoute(q: string): RouteResult {
  for (const pattern of sortedRoutePatterns) {
    for (const regex of pattern.patterns) {
      const match = q.match(regex)
      if (!match) continue

      // 후행 의도가 있으면 양보 — 가드 어휘는 수신 패턴에서 파생된다(#123)
      if (yieldsToOther(pattern, q)) break

      const params = pattern.extract(q, match)

      // _clarify 는 조기 return(_fallback/_reroute)보다 먼저 떼어낸다 —
      // 뒤에서 떼면 그 경로로 나갈 때 내부 플래그가 도구 파라미터로 샌다
      const clarify = typeof params._clarify === "string" ? params._clarify : undefined
      delete params._clarify

      // _skip 플래그: 이 패턴은 매칭되었으나 의도가 다름 → 다음 패턴으로 진행
      // break로 inner loop(regex 목록) 전체를 빠져나가야 outer loop(패턴 목록)이 다음으로 진행
      if (params._skip) break

      // _fallback 플래그: 법령명 없이 키워드만 → 종합 리서치
      if (params._fallback) {
        return {
          tool: "chain_full_research",
          matchedPattern: pattern.name,
          params: { query: q },
          reason: `${pattern.reason} (법령명 미지정 → 종합 리서치로 전환)`,
        }
      }

      // _reroute 플래그: 복합 의도에서 더 적합한 도구로 재라우팅
      if (params._reroute) {
        const rerouteTool = params._reroute as string
        delete params._reroute
        return {
          tool: rerouteTool,
          matchedPattern: pattern.name,
          params,
          reason: `${pattern.reason} → ${rerouteTool}로 재라우팅`,
        }
      }

      // _needsMst 플래그: 법령 검색이 먼저 필요한 경우 파이프라인 구성
      if (params._needsMst) return _mstPipeline(q, pattern, params)

      // 검색 도구에 상세조회 체인이 설정되어 있으면 자동 파이프라인 추가
      const chain = SEARCH_DETAIL_CHAINS[pattern.tool]
      if (chain) {
        // "판결 전문 보여줘" 처럼 축약 해제를 요구하면 상세조회에 전달(#103).
        // 받지 못하는 도구면 Zod 가 조용히 버리므로 미적용 사실을 남긴다(#120)
        const wantsFull = wantsFullText(q)
        const supported = wantsFull && chain.supportsFull === true
        return {
          tool: pattern.tool,
          matchedPattern: pattern.name,
          params,
          reason: pattern.reason,
          pipeline: [{ tool: chain.detailTool, params: supported ? { full: true } : {} }],
          autoChain: true,
          ...(wantsFull && !supported ? { unsupportedParams: ["full"] } : {}),
          ...(clarify ? { clarify } : {}),
        }
      }

      return {
        tool: pattern.tool,
        matchedPattern: pattern.name,
        params,
        reason: pattern.reason,
        ...(clarify ? { clarify } : {}),
      }
    }
  }

  // 기본 폴백: 종합 리서치 체인
  return {
    tool: "chain_full_research",
    params: { query: q },
    reason: "패턴 미매칭 → 종합 리서치 (AI검색+법령+판례+해석례 병렬)",
  }
}

/**
 * 법령 검색(MST 확보) → 상세 조회 파이프라인.
 * 조문이 여러 개면("민법 제309조·제310조") 조문마다 단계를 만든다 — 두 번째가 소실되던 문제(#103).
 */
function _mstPipeline(q: string, pattern: Pattern, params: Record<string, unknown>): RouteResult {
  const searchQuery = (params._searchQuery as string) || q
  const joList = (params._joList as string[] | undefined) ?? []
  delete params._needsMst
  delete params._searchQuery
  delete params._joList

  const steps = joList.length > 1
    ? joList.map(jo => ({ tool: pattern.tool, params: { ...params, jo } }))
    : [{ tool: pattern.tool, params: { ...params } }]

  return {
    tool: "search_law",
    matchedPattern: pattern.name,
    params: { query: searchQuery },
    reason: `${pattern.reason} (법령 검색 → 조문 조회 자동 연결)`,
    pipeline: steps,
  }
}

