/**
 * 자치법규 ↔ 조문 관련성 확인 (#124)
 *
 * 업스트림 자치법규 검색(target=ordin)은 section=ordinNm — 자치법규명만 훑는다.
 * "도로교통법 제148조의2"를 물어도 조번호는 무시되고 158건이 그대로 온다(#117 실증).
 * 이름으로는 좁힐 수 없으니, 본문을 실제로 열어 그 조문을 인용하는지 확인한다.
 *
 * 비용이 이 설계의 전부다 (2026-08-17 실측: 건당 1.03s / 3.4KB).
 *   - 상한을 둔다. 무제한이면 158건 × 1s = 요청 예산(MCP_MAX_UPSTREAM_REQUESTS 기본 48)을
 *     혼자 태운다. 기본 10건이면 10호출 ≈ 34KB로 예산의 약 1/5.
 *   - 병렬로 던져 벽시계는 1왕복에 수렴시킨다.
 *   - 캐시에 태운다 — 같은 조례가 여러 질의에 반복 등장한다.
 *   - 상한 밖은 **버리지 않고** 미확인으로 남긴다. 확인 못 한 것을 무관으로 단정하면
 *     #117에서 고친 과대주장을 반대 방향으로 되풀이하는 셈이다.
 */
import type { LawApiClient } from "./api-client.js"
import { lawCache } from "./cache.js"
import { classifyArticleRefs, parseArticleAnchor } from "./article-anchor.js"

/** 건당 1왕복이 붙는다 — 기본값을 올릴 땐 요청 예산(기본 48회)과 함께 보라 */
export const DEFAULT_RELEVANCE_LIMIT = 10

export interface RelevanceTarget {
  lawName: string
  jo: string
  apiKey?: string
  limit?: number
}

export interface RelevanceOutcome<T> {
  /** 본문에서 해당 법령·조문 인용이 확인된 항목 */
  confirmed: T[]
  /** 확인되지 않은 항목 — 무관하다는 뜻이 **아니다** */
  unconfirmed: T[]
  /** 본문을 실제로 열어본 건수 */
  checked: number
  /** 상한 때문에 열어보지 못한 건수 */
  skipped: number
}

async function fetchBody(apiClient: LawApiClient, id: string, apiKey?: string): Promise<string> {
  const key = `ordinbody:${id}`
  const cached = lawCache.get<string>(key)
  if (cached) return cached
  try {
    const text = await apiClient.getOrdinance(id, undefined, apiKey)
    lawCache.set(key, text)
    return text
  } catch {
    return ""   // 조회 실패는 '무관'이 아니라 '미확인'
  }
}

/**
 * 상위 limit건의 본문을 열어 대상 조문 인용 여부를 확인한다.
 * 판정은 조문 경계 앵커(법령명 축 포함)를 그대로 쓴다 — 같은 규칙으로 재판정해야
 * impact_map·verify_citations와 결론이 갈리지 않는다.
 */
export async function filterByArticleRelevance<T>(
  apiClient: LawApiClient,
  items: T[],
  idOf: (item: T) => string | undefined,
  target: RelevanceTarget
): Promise<RelevanceOutcome<T>> {
  const anchor = parseArticleAnchor(target.jo, target.lawName)
  const limit = target.limit ?? DEFAULT_RELEVANCE_LIMIT
  if (!anchor || items.length === 0) {
    return { confirmed: [], unconfirmed: items, checked: 0, skipped: 0 }
  }

  const head = items.slice(0, limit)
  const tail = items.slice(limit)
  const bodies = await Promise.all(
    head.map(item => {
      const id = idOf(item)
      return id ? fetchBody(apiClient, id, target.apiKey) : Promise.resolve("")
    })
  )

  const confirmed: T[] = []
  const unconfirmed: T[] = []
  head.forEach((item, i) => {
    // 인용이 확정된 것만 승격한다. hold/silent는 "못 읽었다"이지 "인용한다"가 아니다.
    if (bodies[i] && classifyArticleRefs(bodies[i], anchor) === "match") confirmed.push(item)
    else unconfirmed.push(item)
  })

  return { confirmed, unconfirmed: [...unconfirmed, ...tail], checked: head.length, skipped: tail.length }
}
