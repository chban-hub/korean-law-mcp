/**
 * 라우팅 결정 설명기 — CLI `--verbose` / `explain` 출력 전용.
 *
 * 라우팅 엔진(query-router)에서 분리했다. 어느 규칙이 왜 이겼는지 보여주는 표시 계층이라
 * 라우팅 판단과 수명이 다르다.
 */
import { routeQuery, type RouteResult } from "./query-router.js"

/**
 * 쿼리 의도 분석 결과 (CLI --verbose / explain 출력용).
 *
 * 이미 라우팅한 결과가 있으면 넘겨라 — 다시 계산하면 날짜 파싱까지 두 번 돌고,
 * 설명이 실제로 실행된 라우팅과 갈릴 수 있다(#132).
 */
export function explainRoute(query: string, route: RouteResult = routeQuery(query)): string {
  let explanation = `질의: "${query}"\n`
  explanation += `도구: ${route.tool}\n`
  explanation += `근거: ${route.reason}${route.matchedPattern ? ` [${route.matchedPattern}]` : ""}\n`
  explanation += `파라미터: ${JSON.stringify(route.params, null, 2)}\n`

  if (route.dateRange) {
    explanation += `날짜범위: ${route.dateRange.from} ~ ${route.dateRange.to}\n`
  }

  // CLI 본 출력이 알려 주는 것을 설명기도 알려 준다 — 분리 후 표류했던 두 필드(#142)
  if (route.unsupportedParams?.length) {
    explanation += `미적용 파라미터: ${route.unsupportedParams.join(", ")} (목적지 도구가 받지 않음)\n`
  }

  if (route.clarify) {
    explanation += `확인 요청: ${route.clarify}\n`
  }

  if (route.pipeline) {
    explanation += `파이프라인:\n`
    for (const step of route.pipeline) {
      explanation += `  → ${step.tool}(${JSON.stringify(step.params)})\n`
    }
  }

  return explanation
}
