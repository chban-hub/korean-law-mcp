/**
 * Smart Query Router
 * 자연어 질의를 분석하여 최적의 도구/체인으로 라우팅
 *
 * 패턴 매칭 기반으로 의도를 파악하고, 필요한 파라미터를 자동 추출.
 * 패턴 테이블은 route-patterns.ts, 추출기는 query-extract.ts,
 * 시나리오 판정 어휘는 scenario-rules.ts (CLI·MCP 공통 원본).
 */

import { SEARCH_DETAIL_CHAINS } from "./tool-chain-config.js"
import { parseDateRange, stripDateExpressions, type DateRange } from "./date-parser.js"
import { sortedRoutePatterns, type Pattern } from "./route-patterns.js"
import { detectScenarioName } from "./scenario-rules.js"
import { wantsFullText } from "./query-extract.js"

export interface RouteResult {
  /** 실행할 도구 이름 */
  tool: string
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
    if (typeof result.params.query === "string") {
      const cleaned = stripDateExpressions(result.params.query)
      if (cleaned) result.params.query = cleaned
    }
  }

  // 시나리오는 단일 원본(scenario-rules)이 판정한다 — 라우터가 별도 규칙을 갖지 않으므로
  // CLI(params.scenario)와 MCP(chain 의 detectScenario)가 갈릴 수 없다(#101)
  if (result.tool.startsWith("chain_")) {
    const scenario = detectScenarioName(q, result.tool)
    if (scenario) result.params.scenario = scenario
  }

  return result
}

/** 패턴 매칭 내부 함수 (routeQuery에서만 호출) */
function _matchRoute(q: string): RouteResult {
  for (const pattern of sortedRoutePatterns) {
    for (const regex of pattern.patterns) {
      const match = q.match(regex)
      if (!match) continue

      const params = pattern.extract(q, match)

      // _skip 플래그: 이 패턴은 매칭되었으나 의도가 다름 → 다음 패턴으로 진행
      // break로 inner loop(regex 목록) 전체를 빠져나가야 outer loop(패턴 목록)이 다음으로 진행
      if (params._skip) break

      // _fallback 플래그: 법령명 없이 키워드만 → 종합 리서치
      if (params._fallback) {
        return {
          tool: "chain_full_research",
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
          params,
          reason: `${pattern.reason} → ${rerouteTool}로 재라우팅`,
        }
      }

      // _needsMst 플래그: 법령 검색이 먼저 필요한 경우 파이프라인 구성
      if (params._needsMst) return _mstPipeline(q, pattern, params)

      // 검색 도구에 상세조회 체인이 설정되어 있으면 자동 파이프라인 추가
      const chain = SEARCH_DETAIL_CHAINS[pattern.tool]
      if (chain) {
        // "판결 전문 보여줘" 처럼 축약 해제를 요구하면 상세조회에 전달(#103)
        const detailParams = wantsFullText(q) ? { full: true } : {}
        return {
          tool: pattern.tool,
          params,
          reason: pattern.reason,
          pipeline: [{ tool: chain.detailTool, params: detailParams }],
          autoChain: true,
        }
      }

      return { tool: pattern.tool, params, reason: pattern.reason }
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
    params: { query: searchQuery },
    reason: `${pattern.reason} (법령 검색 → 조문 조회 자동 연결)`,
    pipeline: steps,
  }
}

/**
 * 쿼리 의도 분석 결과 (디버깅/로깅용)
 */
export function explainRoute(query: string): string {
  const result = routeQuery(query)
  let explanation = `질의: "${query}"\n`
  explanation += `도구: ${result.tool}\n`
  explanation += `근거: ${result.reason}\n`
  explanation += `파라미터: ${JSON.stringify(result.params, null, 2)}\n`

  if (result.dateRange) {
    explanation += `날짜범위: ${result.dateRange.from} ~ ${result.dateRange.to}\n`
  }

  if (result.pipeline) {
    explanation += `파이프라인:\n`
    for (const step of result.pipeline) {
      explanation += `  → ${step.tool}(${JSON.stringify(step.params)})\n`
    }
  }

  return explanation
}
