/**
 * 별표/서식 표기 문법 — 이 레포의 단일 원본.
 *
 * "별표4" · "별표 제4호" · "별표 1의2"(= 별표 제1호의2)는 같은 것을 가리키는 세 표기다.
 * 법제처 별표번호는 6자리 코드(AAAABB)인데 모델도 사람도 그렇게 부르지 않는다.
 * 그 간극을 여기서 한 번만 흡수한다 — 도구 입력(get_annexes.lawName)과 자연어 라우팅이
 * 각자 파서를 두면 문법이 갈라져 한쪽만 "제28호"를 못 읽고 법령명에 흘린다.
 */

/** 번호부 문법 — "28" · "제28호" · "1의2" · "제1호의2" · "제59호의2서식" */
const ANNEX_NO_SRC = `(\\d{1,6})\\s*(?:호)?\\s*(?:의\\s*(\\d{1,2}))?`
const ANNEX_NUMBER_RE = new RegExp(ANNEX_NO_SRC)
/** 법령명에 붙어 오는 전체 표기 — 떼어내려면 접두어까지 소비해야 한다 */
const ANNEX_HINT_RE = new RegExp(`\\[?\\s*(?:별표|서식)\\s*(?:제)?\\s*${ANNEX_NO_SRC}\\s*\\]?`)

/** 별표 표기의 번호부. 가지번호(의N)가 없으면 sub = null */
export function parseAnnexNumber(raw: string): { main: number, sub: number | null } | undefined {
  const m = raw.match(ANNEX_NUMBER_RE)
  if (!m) return undefined
  const main = Number.parseInt(m[1], 10)
  if (Number.isNaN(main)) return undefined
  return { main, sub: m[2] ? Number.parseInt(m[2], 10) : null }
}

/**
 * 법제처 별표번호 6자리 코드 AAAABB — 번호 4자리 + 가지번호 2자리(없으면 00).
 * JO 코드와 같은 체계다. 2026-08-17 licbyl 실호출로 확정:
 * `002800`=별표 28, `012800`=별지 제128호, `002003`=별지 제20호의3, `001712`=별지 제17호의12.
 */
export function toAnnexCode(main: number, sub: number): string {
  return String(main).padStart(4, "0") + String(sub).padStart(2, "0")
}

/**
 * 법령명 문자열에 섞인 별표 표기를 떼어낸다.
 * 가지번호가 있으면 6자리 코드로, 없으면 정수 문자열로 돌려준다
 * (뒤쪽은 buildSelectorCandidates 가 6자리 후보를 만들어 흡수한다).
 */
export function parseLawNameAndHint(lawName: string): { normalizedLawName: string, annexNo?: string } {
  const trimmedLawName = lawName.trim()
  const annexHintMatch = trimmedLawName.match(ANNEX_HINT_RE)

  if (!annexHintMatch) {
    return { normalizedLawName: trimmedLawName }
  }

  const parsed = parseAnnexNumber(annexHintMatch[0])
  const normalizedLawName = trimmedLawName
    .replace(annexHintMatch[0], " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!parsed) {
    return { normalizedLawName: normalizedLawName || trimmedLawName }
  }

  return {
    normalizedLawName: normalizedLawName || trimmedLawName,
    annexNo: parsed.sub != null ? toAnnexCode(parsed.main, parsed.sub) : String(parsed.main),
  }
}
