/**
 * impact_map — 조문 한 줄의 파급효과 그래프 (v4.0 killer feature)
 *
 * lawName + jo(자연어 표기 또는 6자리 JO 코드)를 받아 조문 본문 조회와 5개 역방향 검색
 * (판례·헌재·해석례·행정심판·자치법규)을 병렬로 돌리고, 조문 경계 앵커로 무관 조문 항목을
 * 걸러 낸 뒤 텍스트 트리 + mermaid로 낸다.
 *
 * 차별점: 다른 모든 chain은 query 기반 단방향. 이 도구는 "특정 조문 → 영향받는 모든 곳" 역방향 그래프.
 */
import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { findLaws, resolvedLawMatches } from "../lib/law-search.js"
import { parseArticleAnchor } from "../lib/article-anchor.js"
import { parseBucket, bucketNote, extractCitedLaws, buildMermaid, type BucketStat } from "../lib/impact-buckets.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError } from "../lib/errors.js"
import { renderPrecedentSearchResult } from "./precedents.js"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { searchInterpretations } from "./interpretations.js"
import { searchAdminAppeals } from "./admin-appeals.js"
import { searchOrdinance } from "./ordinance-search.js"
import { searchConstitutionalDecisions } from "./constitutional-decisions.js"
import { getArticleDetail } from "./article-detail.js"

export const ImpactMapSchema = z.object({
  lawName: z.string().describe("법령명 (예: '민법', '근로기준법')"),
  jo: z.string().describe("조문 번호 — 자연어 표기('제103조', '제10조의2') 또는 6자리 JO 코드('010300')"),
  includeOrdinances: z.boolean().optional().default(true).describe("자치법규 인용 검색 포함 (기본 true)"),
  includeMermaid: z.boolean().optional().default(true).describe("mermaid 그래프 코드 출력 (기본 true)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달"),
})

export type ImpactMapInput = z.infer<typeof ImpactMapSchema>

interface CallResult {
  text: string
  isError: boolean
}

async function safeCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (apiClient: LawApiClient, input: any) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>,
  apiClient: LawApiClient,
  input: Record<string, unknown>
): Promise<CallResult> {
  try {
    const r = await handler(apiClient, input)
    return { text: r.content?.[0]?.text || "", isError: !!r.isError }
  } catch (e) {
    return { text: e instanceof Error ? e.message : String(e), isError: true }
  }
}

async function searchPrecedentsWithoutFallback(
  apiClient: LawApiClient,
  input: { query: string; display?: number; page?: number; apiKey?: string }
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const result = await searchPrecedentsStructured(apiClient, {
    ...input,
    display: input.display ?? 10,
    page: input.page ?? 1,
  }, {
    fallbackPolicy: "none",
  })
  return {
    content: [{ type: "text", text: renderPrecedentSearchResult(result) }],
    isError: result.hits.length === 0 || undefined,
  }
}

function errorResponse(text: string) {
  return { content: [{ type: "text", text }], isError: true }
}

export async function impactMap(
  apiClient: LawApiClient,
  input: ImpactMapInput
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  try {
    // 0. 조문 번호 정규화 — get_law_text와 같은 계약(자연어 표기·JO 코드 모두 수용).
    // 해석 못 한 입력을 그대로 검색어에 끼워 넣으면 전 항목 0건이 조용히 사실로 보고된다(#98).
    const anchor = parseArticleAnchor(input.jo)
    if (!anchor) {
      return errorResponse(
        `[INVALID_ARGUMENT] 조문 번호 '${input.jo}'을(를) 해석할 수 없습니다.\n` +
        `지원 형식: '제103조', '제10조의2', 또는 6자리 JO 코드 '010300'.`
      )
    }
    const joDisplay = anchor.display

    // 1. 법령 식별
    const laws = await findLaws(apiClient, input.lawName, input.apiKey, 1)
    if (laws.length === 0) {
      return errorResponse(
        `[NOT_FOUND] '${input.lawName}' 법령을 찾을 수 없습니다.\n⚠️ LLM은 법령·조문을 추측하지 마세요. 법령명을 확인하거나 search_law로 먼저 검색하세요.`
      )
    }
    const law = laws[0]

    // 가드: LIKE 부분매칭 1위를 맹신하면 무관한 법령의 영향 지도를
    // 헤더·그래프·후속 제안까지 확신형으로 그려버린다. 이름이 맞을 때만 진행.
    if (!resolvedLawMatches(input.lawName, law.lawName)) {
      return errorResponse(
        `[NOT_FOUND] '${input.lawName}' 법령을 정확히 찾지 못했습니다. 검색 최상위는 '${law.lawName}'이지만 요청한 법령과 다를 수 있습니다.\n⚠️ LLM은 법령·조문을 추측하지 마세요. search_law로 정식 법령명을 확인한 뒤 다시 호출하세요.`
      )
    }

    // 검색 쿼리 — 정확 매칭이 필요하니 법령명 + 조문번호 조합
    const searchQuery = `${law.lawName} ${joDisplay}`

    // 2. 병렬 탐색. display는 5개 경로 모두 10으로 맞춘다 — 표본이 검색 건수를 덮어야
    // 경계 앵커 통과분을 확정 건수로 보고할 수 있다(덮지 못하면 검색 기준으로 남는다).
    const [articleR, precR, interpR, appealR, constR, ordinanceR] = await Promise.all([
      safeCall(getArticleDetail, apiClient, { mst: law.mst, jo: joDisplay, apiKey: input.apiKey }),
      safeCall(searchPrecedentsWithoutFallback, apiClient, { query: searchQuery, display: 10, apiKey: input.apiKey }),
      safeCall(searchInterpretations, apiClient, { query: searchQuery, display: 10, apiKey: input.apiKey }),
      safeCall(searchAdminAppeals, apiClient, { query: searchQuery, display: 10, apiKey: input.apiKey }),
      safeCall(searchConstitutionalDecisions, apiClient, { query: searchQuery, display: 10, apiKey: input.apiKey }),
      input.includeOrdinances
        ? safeCall(searchOrdinance, apiClient, { query: searchQuery, display: 10, apiKey: input.apiKey })
        : Promise.resolve({ text: "", isError: true } as CallResult),
    ])

    // 3. 결과 집계 (경계 앵커 통과분만)
    const prec = parseBucket(precR, anchor, 5)
    const cons = parseBucket(constR, anchor, 3)
    const interp = parseBucket(interpR, anchor, 5)
    const appeal = parseBucket(appealR, anchor, 3)
    const ordinance = parseBucket(ordinanceR, anchor, 5)

    const citedLaws = articleR.isError ? [] : extractCitedLaws(articleR.text)

    // 4. 텍스트 트리 출력
    const parts: string[] = []
    parts.push(`═══ Impact Map: ${law.lawName} ${joDisplay} ═══`)
    parts.push(`법령: ${law.lawName} (MST ${law.mst}, ${law.lawType})\n`)

    if (!articleR.isError && articleR.text.trim()) {
      const snippet = articleR.text.slice(0, 400).replace(/\n+/g, "\n")
      parts.push(`▶ 대상 조문 본문\n${snippet}${articleR.text.length > 400 ? "...\n" : "\n"}`)
    } else {
      parts.push(`▶ 대상 조문 본문 [NOT_FOUND] 조문 조회 실패 — 법령명·조문번호 확인 필요\n`)
    }

    const rows: Array<{ label: string; stat: BucketStat; last?: boolean }> = [
      { label: "📚 대법원 판례", stat: prec },
      { label: "⚖️ 헌재 결정례", stat: cons },
      { label: "📑 법령해석례", stat: interp },
      { label: "📋 행정심판례", stat: appeal },
    ]
    if (input.includeOrdinances) rows.push({ label: "🏛️ 자치법규", stat: ordinance, last: true })

    parts.push(`▶ 영향 그래프 (이 조문이 인용된 곳)`)
    for (const { label, stat, last } of rows) {
      parts.push(`${last ? "└─" : "├─"} ${label}: ${stat.count}건${bucketNote(stat)}`)
      stat.topItems.forEach(l => parts.push(`${last ? "    " : "│   "}• ${l}`))
    }

    const excludedTotal = rows.reduce((sum, r) => sum + r.stat.excluded, 0)
    if (excludedTotal > 0) {
      parts.push(`⚠️ 법제처 키워드 검색은 조번호를 부분 일치로 물어옵니다(${joDisplay} 질의에 유사 조번호 혼입). 다른 조문 항목 ${excludedTotal}건을 제외했습니다.`)
    }

    if (citedLaws.length > 0) {
      parts.push(`\n▶ 이 조문이 인용한 다른 법령 (정방향)`)
      citedLaws.forEach(cited => parts.push(`  → ${cited}`))
    }

    // 5. 합산 통계
    const total = prec.count + interp.count + appeal.count + cons.count + ordinance.count
    parts.push(`\n▶ 총 영향 건수: ${total}건 (판례 ${prec.count} / 헌재 ${cons.count} / 해석 ${interp.count} / 행심 ${appeal.count} / 조례 ${ordinance.count})`)
    parts.push(`인용 법령: ${citedLaws.length}개\n`)

    // 6. mermaid 그래프
    if (input.includeMermaid) {
      const mermaid = buildMermaid(`${law.lawName} ${joDisplay}`, {
        precedents: prec.count,
        interpretations: interp.count,
        appeals: appeal.count,
        constitutional: cons.count,
        ordinances: ordinance.count,
        citedLaws,
      })
      parts.push(`▶ Mermaid 그래프 (시각화)\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n`)
    }

    // 7. 후속 액션
    parts.push(`━━━ 이어서 할 수 있는 조회 ━━━`)
    parts.push(`1. "${law.lawName} ${joDisplay} 판례" — 판례 상세`)
    parts.push(`2. "${law.lawName} ${joDisplay} 해석례" — 해석례 상세`)
    parts.push(`3. "${law.lawName} 신구대조표" — 개정 이력`)

    return {
      content: [{ type: "text", text: truncateResponse(parts.join("\n")) }],
    }
  } catch (error) {
    return formatToolError(error, "impact_map")
  }
}
