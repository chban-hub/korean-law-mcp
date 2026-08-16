/**
 * 통일된 에러 처리 모듈
 */

import type { ToolResponse } from "./types.js"
import { maskSensitiveUrl } from "./fetch-with-retry.js"
import { UpstreamRecordMissingError } from "./upstream-miss.js"

/**
 * 에러 코드
 */
export const ErrorCodes = {
  NOT_FOUND: "LAW_NOT_FOUND",
  /**
   * 업스트림이 자료를 주지 않았다는 **관측**. 부존재 주장이 아니다.
   * `NOT_FOUND` 계열과 반드시 분리해 둔다 — 기계 독자에게는 산문의 유보보다
   * 대괄호 라벨이 이기고, 이 경로에서 라벨이 "없음"으로 읽히면 실재하는 판례를
   * 없다고 자문하는 거짓 부정이 된다 (_workspace/13_legal_wording_review.md 축①).
   */
  UPSTREAM_NO_DATA: "UPSTREAM_NO_DATA",
  INVALID_PARAM: "INVALID_PARAMETER",
  API_ERROR: "EXTERNAL_API_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "REQUEST_TIMEOUT",
  PARSE_ERROR: "PARSE_ERROR",
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/**
 * 법제처 API 에러
 */
export class LawApiError extends Error {
  code: ErrorCode
  suggestions: string[]

  constructor(message: string, code: ErrorCode, suggestions: string[] = []) {
    super(message)
    this.name = "LawApiError"
    this.code = code
    this.suggestions = suggestions
  }

  format(): string {
    let result = `[ERROR] ${this.message}`
    if (this.suggestions.length > 0) {
      result += "\n제안:"
      this.suggestions.forEach((s, i) => {
        result += `\n  ${i + 1}. ${s}`
      })
    }
    return result
  }
}

/**
 * 도구 에러 응답 생성 -- 구조화된 포맷
 *
 * 출력 형식:
 *   ❌ [에러코드] 메시지
 *   🔧 도구: <toolName>
 *   💡 제안: ...
 */
/**
 * 검색 결과 없음 힌트 생성
 * 법제처 API는 공백 키워드를 AND 조건으로 처리하므로, 키워드가 많으면 결과가 0건이 되기 쉬움
 *
 * [NOT_FOUND] 프리픽스로 LLM이 기계적으로 실패를 감지하게 함 (환각 방지 v3.5.4)
 */
export function noResultHint(query: string, label?: string): ToolResponse {
  const prefix = label ? `${label} ` : ""
  const keywords = query.trim().split(/\s+/)
  const lines = [`[NOT_FOUND] ${prefix}'${query}' 검색 결과가 없습니다.`]
  lines.push("")
  lines.push("⚠️ 이 도구는 실제 데이터를 찾지 못했습니다. LLM이 결과를 추측하거나 지어내지 마세요. 사용자에게 '검색 실패'를 보고하고 아래 제안을 우선 시도하세요.")

  if (keywords.length >= 2) {
    lines.push("")
    lines.push("힌트: 법제처 API는 공백 구분 키워드를 AND 조건으로 처리합니다. 키워드가 많을수록 결과가 줄어듭니다.")
    lines.push(`재시도 제안: "${keywords[0]}" 또는 "${keywords.slice(0, 2).join(" ")}"`)
  } else {
    lines.push("다른 키워드로 재시도하세요.")
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: true,
  }
}

/**
 * 명시적 "데이터 없음" 응답 생성 (환각 방지 v3.5.4)
 * noResultHint는 검색 실패용. 특정 리소스가 없을 때(조문, 별표, 파일 등) 사용.
 */
export function notFoundResponse(message: string, suggestions?: string[]): ToolResponse {
  const lines = [`[NOT_FOUND] ${message}`]
  lines.push("")
  lines.push("⚠️ 이 도구는 요청한 데이터를 찾지 못했습니다. LLM이 임의로 답변을 생성하지 마세요. '해당 데이터 없음'을 사용자에게 명시하세요.")
  if (suggestions && suggestions.length > 0) {
    lines.push("")
    lines.push("재시도 제안:")
    suggestions.forEach((s) => lines.push(`  - ${s}`))
  }
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: true,
  }
}

export function formatToolError(error: unknown, context?: string): ToolResponse {
  let code: string
  let msg: string
  let suggestions: string[]

  if (error instanceof LawApiError) {
    code = error.code || ErrorCodes.API_ERROR
    msg = error.message
    suggestions = error.suggestions || []
  } else if (error instanceof UpstreamRecordMissingError) {
    // 관측 사실만 라벨에 담는다. 두 방향의 사고 — 없는 것을 지어내기와 있는 것을
    // 없다고 단정하기 — 를 나란히 금지하고, 구별 불가한 두 원인에 순위를 매기지 않는다.
    code = ErrorCodes.UPSTREAM_NO_DATA
    msg = error.message
    suggestions = [
      "⚠️ 이 응답은 자료의 부존재를 증명하지 않습니다. 사용자에게 '조회 실패'로 보고하고, '그런 법령·판례는 없다'고 단정하지 마세요.",
      "⚠️ 자료를 받지 못했습니다. 내용을 추측하거나 지어내지 마세요.",
      "원인은 둘 중 하나이며 이 응답만으로는 구별되지 않습니다 — (a) 해당 ID/MST의 자료가 실제로 없음, (b) 법제처 점검·과부하로 본문이 빈 채 옴.",
      "잠시 후 재시도해 보고, 그래도 같으면 ID/MST를 search_* 결과에서 재확인하세요 (임의 생성 금지).",
    ]
  } else if (error instanceof Error) {
    // Zod validation 에러 감지
    if (error.name === "ZodError" && Array.isArray((error as any).issues)) {
      code = ErrorCodes.INVALID_PARAM
      msg = (error as any).issues
        .map((i: { path: string[]; message: string }) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
      suggestions = ["파라미터 형식과 필수 값을 확인하세요."]
    } else {
      code = ErrorCodes.API_ERROR
      msg = error.message
      suggestions = []
    }
  } else {
    code = ErrorCodes.API_ERROR
    msg = String(error)
    suggestions = []
  }

  const lines: string[] = []
  // 최종 방어선 — 도구 코드가 URL 포함 에러를 직접 만들어도 API 키가 클라이언트로 새지 않게
  lines.push(`[${code}] ${maskSensitiveUrl(msg)}`)

  if (context) {
    lines.push(`도구: ${context}`)
  }

  if (suggestions.length > 0) {
    lines.push("제안:")
    suggestions.forEach((s, i) => {
      lines.push(`  ${i + 1}. ${s}`)
    })
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError: true,
  }
}

