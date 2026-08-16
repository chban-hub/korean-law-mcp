/**
 * 별표/서식 표기 문법 — 이 레포의 단일 원본.
 *
 * "별표4" · "별표 제4호" · "별표 1의2"(= 별표 제1호의2)는 같은 것을 가리키는 세 표기다.
 * 법제처 별표번호는 6자리 코드(AAAABB)인데 모델도 사람도 그렇게 부르지 않는다.
 * 그 간극을 여기서 한 번만 흡수한다 — 도구 입력(get_annexes.lawName)과 자연어 라우팅이
 * 각자 파서를 두면 문법이 갈라져 한쪽만 "제28호"를 못 읽고 법령명에 흘린다.
 */

/**
 * 법령명 문자열에 섞인 별표 표기를 떼어낸다.
 * 의-번호가 있으면 6자리 코드로, 없으면 정수 문자열로 돌려준다
 * (뒤쪽은 buildSelectorCandidates 가 6자리 후보를 만들어 흡수한다).
 */
export function parseLawNameAndHint(lawName: string): { normalizedLawName: string, annexNo?: string } {
  const trimmedLawName = lawName.trim()
  // "별표1", "별표 제1호", "별표 1의2" 모두 매칭. 의-번호는 별도 캡처해 법령명에 남지 않게 한다.
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
  const annexNo = subNo != null
    ? String(mainNo).padStart(4, "0") + String(subNo).padStart(2, "0")
    : String(mainNo)

  return {
    normalizedLawName: normalizedLawName || trimmedLawName,
    annexNo
  }
}
