/**
 * 별표/서식 선택 — 사용자가 준 힌트(번호·제목 키워드)로 목록에서 항목을 고른다.
 *
 * 법제처 별표번호는 6자리 코드(AAAABB)지만 모델은 "별표4", "제4호", "4"처럼
 * 제각각 부르고, 같은 번호에 별표와 서식이 공존하기도 한다. 그 간극을 여기서 흡수한다.
 */

/** 법제처 별표/서식 API 응답 개별 항목 */
export interface AnnexItem {
  별표번호?: string
  별표명?: string
  별표종류?: string
  별표서식파일링크?: string
  별표서식PDF파일링크?: string
  별표파일링크?: string
  관련법령명?: string
  관련자치법규명?: string
  관련행정규칙명?: string
  자치법규시행일자?: string
  공포일자?: string
  소관부처?: string
  소관부처명?: string
  지자체기관명?: string
  관련법령일련번호?: string
}

/**
 * 모법명 추출 (시행규칙/시행령 제거)
 * "여권법 시행규칙" → "여권법", "관세법 시행령" → "관세법"
 */
export function extractParentLawName(lawName: string): string | null {
  const cleaned = lawName.replace(/\s*(시행규칙|시행령)$/, '')
  return cleaned !== lawName ? cleaned : null
}

export function parseLawNameAndHint(lawName: string): { normalizedLawName: string, annexNo?: string } {
  const trimmedLawName = lawName.trim()
  // "별표1", "별표 제1호", "별표 1의2"(= 별표 제1호의2) 모두 매칭. 의-번호는 별도 캡처해 법령명에 남지 않게 한다.
  const annexHintMatch = trimmedLawName.match(/\[?\s*(별표|서식)\s*(?:제)?\s*(\d{1,6})\s*(?:호)?\s*(?:의\s*(\d{1,2}))?\s*\]?/)

  if (!annexHintMatch) {
    return { normalizedLawName: trimmedLawName }
  }

  const mainNo = Number.parseInt(annexHintMatch[2], 10)
  const subNo = annexHintMatch[3] ? Number.parseInt(annexHintMatch[3], 10) : null
  const normalizedLawName = trimmedLawName
    .replace(annexHintMatch[0], " ")
    .replace(/\s+/g, " ")
    .trim()

  if (Number.isNaN(mainNo)) {
    return { normalizedLawName: normalizedLawName || trimmedLawName }
  }

  // 의-번호가 있으면 법제처 별표번호 6자리 코드(AAAABB)로 변환 (별표 1의2 → "000102").
  // 없으면 기존 동작 유지(정수 문자열 → buildSelectorCandidates가 6자리 코드 후보 생성).
  const annexNo = subNo != null
    ? String(mainNo).padStart(4, "0") + String(subNo).padStart(2, "0")
    : String(mainNo)

  return {
    normalizedLawName: normalizedLawName || trimmedLawName,
    annexNo
  }
}

/**
 * 별표 선택값으로 항목 매칭.
 *
 * 자치법규 등에서 [별표 N]과 [별지 제N호서식]이 동일 별표번호(bylSeq)를 공유하는 경우가
 * 있어, 번호만으로 find() 하면 목록 순서상 먼저 오는 항목(주로 서식)이 잘못 선택된다.
 * (예: 서울특별시 건축 조례 — [별표4] 대지안의 공지기준 / [별지 제4호서식] 공개공지 관리대장이
 *  모두 별표번호 000400을 가짐.)
 * 따라서 번호가 일치하는 후보를 모두 모은 뒤, knd(별표/서식 의도)로 별표종류를 구분해
 * 올바른 항목을 고른다. knd 미지정 시 표(별표)를 서식보다 우선한다.
 */
export function findMatchingAnnex(
  annexList: AnnexItem[],
  annexSelector: string,
  knd?: string
): AnnexItem | undefined {
  const selectorCandidates = buildSelectorCandidates(annexSelector)
  const selectorNumbers = extractSelectorNumbers(annexSelector)

  // 번호/제목으로 매칭되는 후보 "전체" 수집 (find → filter)
  const matches = annexList.filter((annex: AnnexItem) => {
    const annexNum = String(annex.별표번호 || "").trim()
    const annexTitle = String(annex.별표명 || "")
    if (annexNum && selectorCandidates.has(annexNum)) {
      return true
    }
    return selectorNumbers.some((num) => titleMatchesAnnexNumber(annexTitle, num))
  })

  if (matches.length === 0) {
    // 번호가 안 맞아도 별표가 유일 1건이면 그 별표를 정답으로 폴백.
    // 여권법 시행령 '수수료 및 사무의 대행에 드는 비용(제39조 관련)'처럼 번호 없는 단일 별표는
    // 모델이 "별표1" 등 임의 번호로 불러도 매칭 0건 → NOT_FOUND로 새는 대신 유일 별표를 반환.
    if (annexList.length === 1) return annexList[0]
    return undefined
  }
  if (matches.length === 1) return matches[0]

  // 별표번호 충돌 → 별표종류("별표"/"서식")로 구분
  const isForm = (a: AnnexItem) => /서식/.test(String(a.별표종류 || ""))
  const isTable = (a: AnnexItem) => /별표/.test(String(a.별표종류 || ""))

  if (knd === "2" || knd === "4") {
    // 서식을 명시적으로 요청
    return matches.find(isForm) || matches[0]
  }
  if (knd === "1" || knd === "3") {
    // 별표를 명시적으로 요청
    return matches.find(isTable) || matches[0]
  }
  // knd 미지정/전체(5): 표(별표)를 서식보다 우선
  return matches.find(isTable) || matches[0]
}

export function buildSelectorCandidates(selector: string): Set<string> {
  const candidates = new Set<string>()
  const trimmed = selector.trim()

  if (!trimmed) {
    return candidates
  }

  candidates.add(trimmed)

  const numMatch = trimmed.match(/(\d{1,6})/)
  if (!numMatch) {
    return candidates
  }

  const rawDigits = numMatch[1]
  const asNumber = Number.parseInt(rawDigits, 10)
  if (Number.isNaN(asNumber)) {
    return candidates
  }

  candidates.add(rawDigits)
  candidates.add(String(asNumber))

  // 법제처 별표번호는 관행적으로 000100, 000200 형식이 많아 둘 다 허용
  candidates.add(String(asNumber).padStart(6, "0"))
  if (rawDigits.length <= 3) {
    candidates.add(String(asNumber * 100).padStart(6, "0"))
  }

  return candidates
}

export function extractSelectorNumbers(selector: string): string[] {
  const numbers = new Set<string>()
  const numMatch = selector.match(/(\d{1,6})/)
  if (!numMatch) {
    return []
  }

  const rawDigits = numMatch[1]
  const asNumber = Number.parseInt(rawDigits, 10)
  if (Number.isNaN(asNumber)) {
    return []
  }

  numbers.add(String(asNumber))

  if (rawDigits.length === 6 && asNumber % 100 === 0) {
    numbers.add(String(asNumber / 100))
  }

  return Array.from(numbers)
}

function titleMatchesAnnexNumber(title: string, annexNumber: string): boolean {
  const escapedNumber = escapeRegex(annexNumber)
  const patterns = [
    new RegExp(`\\[\\s*별표\\s*${escapedNumber}\\s*\\]`),
    new RegExp(`별표\\s*제?\\s*${escapedNumber}\\s*(?:호)?`),
    new RegExp(`\\[\\s*서식\\s*${escapedNumber}\\s*\\]`),
    new RegExp(`서식\\s*제?\\s*${escapedNumber}\\s*(?:호)?`)
  ]

  if (patterns.some((pattern) => pattern.test(title))) {
    return true
  }

  // 묶음 별표 범위 매칭: "[별표1~5]", "[별표 1 ~ 5]" 등
  const num = Number.parseInt(annexNumber, 10)
  if (!Number.isNaN(num)) {
    const rangePattern = /별표\s*(\d+)\s*[~\-]\s*(\d+)/g
    let match: RegExpExecArray | null
    while ((match = rangePattern.exec(title)) !== null) {
      const start = Number.parseInt(match[1], 10)
      const end = Number.parseInt(match[2], 10)
      if (num >= start && num <= end) {
        return true
      }
    }
  }

  return false
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** 묶음 별표 여부 판별: "[별표1~5]" 같은 범위 표기가 있는지 */
export function isBundledAnnex(annexTitle: string): boolean {
  return /별표\s*\d+\s*[~\-]\s*\d+/.test(annexTitle)
}

/** 묶음 별표 마크다운에서 특정 별표 섹션만 추출 */
export function extractBundledSection(markdown: string, targetNum: string): string | null {
  const num = parseInt(targetNum, 10)
  if (isNaN(num)) return null

  const pattern = new RegExp(
    `(##\\s*\\[별표\\s*${num}\\][\\s\\S]*?)(?=##\\s*\\[별표\\s*\\d|$)`
  )
  const match = markdown.match(pattern)
  return match ? match[1].trim() : null
}

/**
 * 관련법규명으로 annexList 필터링: 사용자 쿼리와 가장 일치하는 조례 우선
 * 여러 조례(예: "광진구의회 복무 조례" vs "광진구 복무 조례")가 혼합된 경우 분리
 */
export function filterByRelatedLawName(annexList: AnnexItem[], queryName: string): AnnexItem[] {
  if (annexList.length <= 1) return annexList

  // 쿼리에서 단어 추출
  const queryWords = queryName.split(/\s+/).filter((w) => w.length > 0)
  if (queryWords.length === 0) return annexList

  // 각 항목에 관련법규명 단어 매칭 점수 부여
  const scored = annexList.map((annex: AnnexItem) => {
    // 관련행정규칙명도 본다 — 빠뜨리면 admbyl 폴백 결과가 전부 0점이라 필터를 그대로
    // 통과해, 요청 법령명을 부분 포함하는 무관 행정규칙의 별표가 함께 섞여 나온다
    const relatedName = String(annex.관련자치법규명 || annex.관련법령명 || annex.관련행정규칙명 || "")
      .replace(/<[^>]+>/g, "")   // HTML 태그 제거
    const relatedWords = relatedName.split(/\s+/).filter((w) => w.length > 0)
    // 쿼리 단어가 관련법규명에 정확히 포함되는 수
    const score = queryWords.filter((qw) => relatedWords.includes(qw)).length
    return { annex, score }
  })

  const maxScore = Math.max(...scored.map((s) => s.score))
  if (maxScore === 0) return annexList

  // 최고 점수 항목만 필터 (동점 허용)
  const best = scored.filter((s) => s.score === maxScore).map((s) => s.annex)
  return best.length > 0 ? best : annexList
}

// ─── query 필터 (#94) ─────────────────────────────────

/**
 * query에서 별표명 검색에 쓸 키워드를 뽑는다.
 * 번호 힌트("별표28")는 selector 쪽에서 이미 쓰이므로 여기서는 제외하고,
 * 조사·군더더기("기준", "관련")까지 붙은 자연어를 그대로 토큰으로 쓴다.
 */
export function annexQueryKeywords(query?: string): string[] {
  if (!query) return []
  return query
    .replace(/\[?\s*(별표|서식|별지)\s*(?:제)?\s*\d{1,6}\s*(?:호)?\s*(?:의\s*\d{1,2})?\s*\]?/g, " ")
    .split(/[\s,·ㆍ]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

/**
 * 별표명이 키워드를 모두 담고 있는지. 전부 만족(AND)을 요구해야
 * "운전면허 취소"가 "운전면허" 하나만 걸린 수십 건으로 번지지 않는다.
 */
export function matchesAnnexKeywords(annex: AnnexItem, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const title = String(annex.별표명 || "").replace(/<[^>]+>/g, "")
  return keywords.every((k) => title.includes(k))
}

/**
 * query 키워드로 목록을 좁힌다. 한 건도 못 맞히면 원본을 돌려주고 matched=false로
 * 알린다 — 조용히 전체 목록을 주면 "필터가 동작한 결과"로 오인된다(#94의 증상 자체).
 */
export function filterByAnnexQuery(
  annexList: AnnexItem[],
  query?: string
): { list: AnnexItem[], keywords: string[], matched: boolean } {
  const keywords = annexQueryKeywords(query)
  if (keywords.length === 0) return { list: annexList, keywords, matched: true }

  const hits = annexList.filter((a) => matchesAnnexKeywords(a, keywords))
  return hits.length > 0
    ? { list: hits, keywords, matched: true }
    : { list: annexList, keywords, matched: false }
}
