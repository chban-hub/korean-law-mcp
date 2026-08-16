/**
 * 라우팅 결정 설명기 — CLI `--verbose` / `explain` 출력 전용.
 *
 * 라우팅 엔진(query-router)에서 분리했다. 어느 규칙이 왜 이겼는지 보여주는 표시 계층이라
 * 라우팅 판단과 수명이 다르다.
 */
import { routeQuery } from "./query-router.js"
/**
 * 쿼리 의도 분석 결과 (CLI --verbose / explain 출력용)
 */
export function explainRoute(query: string): string {
  const result = routeQuery(query)
  let explanation = `질의: "${query}"\n`
  explanation += `도구: ${result.tool}\n`
  explanation += `근거: ${result.reason}${result.matchedPattern ? ` [${result.matchedPattern}]` : ""}\n`
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
