/**
 * 공통 Zod 스키마
 */

import { z } from "zod"
import { cutAtSafeBoundary, extractSummary, sliceWellFormed, summaryTail } from "./truncate-text.js"

/**
 * 날짜 스키마 (YYYYMMDD 형식)
 */
export const dateSchema = z
  .string()
  .regex(/^\d{8}$/, "날짜 형식: YYYYMMDD (예: 20240101)")
  .refine(
    (val) => {
      const year = parseInt(val.slice(0, 4), 10)
      const month = parseInt(val.slice(4, 6), 10)
      const day = parseInt(val.slice(6, 8), 10)

      if (year < 1900 || year > 2100) return false
      if (month < 1 || month > 12) return false
      if (day < 1 || day > 31) return false

      // 월별 일수 체크
      const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
      if (month === 2 && isLeapYear) {
        return day <= 29
      }
      return day <= daysInMonth[month - 1]
    },
    { message: "유효하지 않은 날짜입니다." }
  )

/**
 * 선택적 날짜 스키마
 */
export const optionalDateSchema = dateSchema.optional()

/**
 * 페이지네이션 스키마
 */
export const paginationSchema = z.object({
  display: z.number().min(1).max(100).default(20).describe("결과 수 (기본:20, 최대:100)"),
  page: z.number().min(1).default(1).describe("페이지 번호 (기본:1)"),
})

/**
 * 응답 크기 제한 — 5만 "자"(UTF-16 length) 기준이며 바이트가 아니다.
 * 한글은 UTF-8에서 3바이트라 전송 바이트는 이 값의 2~3배가 될 수 있다.
 * 토큰 예산 근사로는 바이트보다 자 수가 낫기 때문에 자 기준을 유지한다(#92).
 */
export const MAX_RESPONSE_SIZE = 50000

/**
 * 날짜 포맷 (YYYYMMDD → YYYY.MM.DD)
 */
export function formatDateDot(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return dateStr || "N/A"
  return `${dateStr.substring(0, 4)}.${dateStr.substring(4, 6)}.${dateStr.substring(6, 8)}`
}

/**
 * truncateResponse 옵션
 */
interface TruncateOptions {
  maxLength?: number
  /** true이면 초과 시 핵심 내용만 요약 추출 */
  summary?: boolean
}

/**
 * 응답 크기 제한 적용
 *
 * @param text - 원본 텍스트
 * @param maxSizeOrOpts - 숫자(최대 길이) 또는 옵션 객체
 */
export function truncateResponse(text: string, maxSizeOrOpts?: number): string
export function truncateResponse(text: string, maxSizeOrOpts?: TruncateOptions): string
export function truncateResponse(text: string, maxSizeOrOpts: number | TruncateOptions = MAX_RESPONSE_SIZE): string {
  let maxSize: number
  let summary = false

  if (typeof maxSizeOrOpts === "object" && maxSizeOrOpts !== null) {
    maxSize = maxSizeOrOpts.maxLength ?? MAX_RESPONSE_SIZE
    summary = !!maxSizeOrOpts.summary
  } else {
    maxSize = maxSizeOrOpts
  }

  if (text.length <= maxSize) return text

  // summary 모드: 핵심 내용(첫 줄 + 섹션 제목들 + 마지막 줄) 추출.
  // 초과분도 경계에서 자른다 — 하드컷하면 `📋 요약 모드` 꼬리가 한가운데서 끊긴다.
  // 같은 커밋이 하드컷을 없애려고 cutAtSafeBoundary를 만들어 놓고 이 경로만 빠뜨렸다(#145).
  if (summary) {
    const extracted = extractSummary(text, maxSize)
    if (extracted.length <= maxSize) return extracted
    // 꼬리(📋 표기)는 문서 맨 끝이라 끝에서 자르면 꼬리부터 사라진다 — 절단·요약
    // 사실이 무표기가 된다(#150). 꼬리 길이를 예산에서 예약하고 본문만 경계 절단 후
    // 다시 붙인다 — 아래 최상위 절단(#92)과 같은 패턴. 재부착 꼬리는 본문이 줄어든
    // 만큼 짧아지거나 같으므로 상한을 넘지 않는다.
    const tailBudget = maxSize - summaryTail(text.length, extracted.length).length
    if (tailBudget <= 0) return sliceWellFormed(extracted, maxSize)
    const body = cutAtSafeBoundary(extracted, tailBudget)
    return body + summaryTail(text.length, body.length)
  }

  // 안내문은 슬라이스 "뒤에" 붙으므로 그 길이를 미리 빼야 한다.
  // 빼지 않으면 결과가 maxSize+안내문 길이(5만 자 요청에 50,030자)가 된다(#92).
  const notice = `\n\n⚠️ 응답이 너무 길어 ${maxSize.toLocaleString()}자로 잘렸습니다.`
  const budget = maxSize - notice.length
  if (budget <= 0) return sliceWellFormed(text, maxSize)
  return cutAtSafeBoundary(text, budget) + notice
}

/**
 * 체인 도구용 섹션별 truncation
 *
 * 형식이 "▶ 섹션제목\n내용" 패턴인 텍스트에서
 * 각 섹션을 개별적으로 길이 제한하여 전체 균형 유지.
 *
 * @param text - "▶ 제목\n내용\n\n▶ 제목\n내용" 형태
 * @param totalMax - 전체 최대 길이
 * @param sectionMax - 섹션당 최대 길이 (기본: totalMax / 섹션 수)
 */
export function truncateSections(
  text: string,
  totalMax: number = MAX_RESPONSE_SIZE,
  sectionMax?: number
): string {
  if (text.length <= totalMax) return text

  // "▶ " 패턴으로 섹션 분리
  const sectionPattern = /(?=▶\s)/g
  const parts = text.split(sectionPattern)

  // 첫 조각이 빈 문자열이거나 헤더 이전 텍스트인 경우 분리
  let preamble = ""
  let sections = parts
  if (parts.length > 0 && !parts[0].startsWith("▶")) {
    preamble = parts[0]
    sections = parts.slice(1)
  }

  if (sections.length === 0) {
    // 섹션 패턴이 없으면 일반 truncation
    return truncateResponse(text, totalMax)
  }

  const perSection = sectionMax || Math.floor((totalMax - preamble.length - 100) / sections.length)

  const truncatedSections = sections.map((sec) => {
    if (sec.length <= perSection) return sec
    // 안내문이 잘라낸 "뒤에" 붙으므로 그 길이를 예산에서 먼저 뺀다 — #92가 최상위에서
    // 고친 것과 같은 유형이 섹션 단위에 남아 있었다(#145). 안 빼면 섹션마다
    // perSection을 안내문 길이만큼 넘는다.
    const notice = `\n   ⚠️ (이 섹션 ${sec.length.toLocaleString()}자 → ${perSection.toLocaleString()}자로 축약)`
    const budget = perSection - notice.length
    if (budget <= 0) return cutAtSafeBoundary(sec, perSection)
    return cutAtSafeBoundary(sec, budget) + notice
  })

  let result = preamble + truncatedSections.join("\n\n")

  // 전체 길이 재확인 — 안내문 길이를 뺀 예산으로 잘라야 totalMax를 넘지 않는다(#92)
  if (result.length > totalMax) {
    const notice = `\n\n⚠️ 전체 응답이 ${totalMax.toLocaleString()}자로 잘렸습니다.`
    const budget = totalMax - notice.length
    result = budget > 0 ? cutAtSafeBoundary(result, budget) + notice : sliceWellFormed(result, totalMax)
  }

  return result
}
