/**
 * 사건번호 인용 — 추출과 실존 확인 (#93)
 *
 * verify_citations는 법령 인용만 검증하고 "대법원 2099다99999" 같은 판례 인용은
 * 추출조차 하지 않았다. [HALLUCINATION_DETECTED] 배너가 붙은 채 판례가 무검증으로
 * 통과하면 소비자(LLM)는 전체가 검증됐다고 읽는다 — 누락보다 오도가 문제다.
 *
 * 판정 원칙: **부존재 단정 금지.** 법제처 수록 판례는 대법원 중심이라
 * "검색되지 않음"과 "존재하지 않음"을 구별할 수 없다. 구조적으로 불가능한 것
 * (미래 연도)만 ✗로 단정하고, 나머지 미검색은 '미확인'으로 남긴다.
 */
import type { LawApiClient } from "./api-client.js"
import { parsePrecedentXML } from "./xml-parser.js"

// 사건부호에 절대 오지 않는 음절 — 조문·날짜·수량 표기를 사건번호로 오인하지 않게 막는다
// ("제999조의9" → 999조의9, "총 20건 3개" → 20건3). 사건부호 후보에서 이 음절들을 뺀다.
const NON_CASE_SYLLABLES = "조항호목의년월일건명개원회번쪽시분"
const CASE_SUFFIX_CHAR = `(?:(?![${NON_CASE_SYLLABLES}])[가-힣])`

// 선행 `제`·숫자를 막는 것이 조문 인용과의 경계다 — "제999조의9"의 999는 사건연도가 아니다.
const CASE_NO_RE = new RegExp(
  `(?<![\\d제])(\\d{2,4})\\s*(${CASE_SUFFIX_CHAR}{1,2})\\s*(\\d{1,7})(?!\\d)`,
  "g"
)

/** 텍스트에서 사건번호 추출 (예: 2013다61381, 96누4671, 2024헌바107) */
export function extractCaseNumbers(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  CASE_NO_RE.lastIndex = 0
  while ((m = CASE_NO_RE.exec(text || "")) !== null) {
    const cn = `${m[1]}${m[2]}${m[3]}`
    if (!seen.has(cn)) {
      seen.add(cn)
      out.push(cn)
    }
  }
  return out
}

/**
 * 구조적으로 실존할 수 없는 사건번호인지. 사건연도가 미래면 어떤 검색 한계로도
 * 설명되지 않으므로 이때만 부존재를 단정한다(2자리 연도는 세기 추정이 필요해 판단하지 않음).
 */
export function isImpossibleCaseNumber(caseNo: string, currentYear: number): boolean {
  const m = /^(\d{4})/.exec(caseNo)
  if (!m) return false
  return Number.parseInt(m[1], 10) > currentYear
}

export interface CaseCitationReport {
  total: number
  ok: number
  fail: number
  unknown: number
  lines: string[]
}

async function verifyOne(
  apiClient: LawApiClient,
  caseNo: string,
  apiKey?: string
): Promise<{ mark: "ok" | "fail" | "unknown"; line: string }> {
  if (isImpossibleCaseNumber(caseNo, new Date().getFullYear())) {
    return {
      mark: "fail",
      line: `✗ ${caseNo} — [NOT_FOUND] 실존할 수 없는 사건번호 (사건연도가 미래)`,
    }
  }
  try {
    const xml = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "prec",
      extraParams: { nb: caseNo, display: "5" },
      apiKey,
    })
    const parsed = parsePrecedentXML(xml)
    const hit = parsed.items.find(i => (i.사건번호 || "").replace(/\s/g, "").includes(caseNo))
    if (hit) {
      const meta = [hit.법원명, hit.선고일자].filter(Boolean).join(" ")
      return { mark: "ok", line: `✓ ${caseNo} 실존 — ${meta} ${hit.판례명 || ""}`.trimEnd() }
    }
    return {
      mark: "unknown",
      line: `⚠ ${caseNo} — 미확인 (법제처 수록 판례에서 검색되지 않음. 하급심·미수록 판례일 수 있어 부존재로 단정 불가)`,
    }
  } catch (e) {
    return {
      mark: "unknown",
      line: `⚠ ${caseNo} — 미확인 (조회 실패: ${e instanceof Error ? e.message : String(e)})`,
    }
  }
}

/** 텍스트의 사건번호 인용을 추출해 법제처 수록 여부를 확인한다. */
export async function verifyCaseCitations(
  apiClient: LawApiClient,
  text: string,
  apiKey?: string,
  max = 5
): Promise<CaseCitationReport> {
  const caseNumbers = extractCaseNumbers(text).slice(0, max)
  if (caseNumbers.length === 0) return { total: 0, ok: 0, fail: 0, unknown: 0, lines: [] }

  const results = await Promise.all(caseNumbers.map(cn => verifyOne(apiClient, cn, apiKey)))
  return {
    total: results.length,
    ok: results.filter(r => r.mark === "ok").length,
    fail: results.filter(r => r.mark === "fail").length,
    unknown: results.filter(r => r.mark === "unknown").length,
    lines: results.map(r => r.line),
  }
}
