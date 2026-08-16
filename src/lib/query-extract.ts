/**
 * 자연어 질의에서 파라미터를 뽑는 추출기 모음 (query-router 전용 헬퍼)
 *
 * 조문번호·법령명·별표번호처럼 "쿼리 문자열 → 도구 파라미터" 변환만 담당한다.
 * 어떤 도구로 갈지(라우팅)는 route-patterns.ts, 시나리오 판정은 scenario-rules.ts.
 */

/**
 * 조문 표기 정규식.
 * `제`는 선택 — 실무에서 "44조", "3조의3" 표기가 통용되는데 이를 놓치면
 * 조문 조회 경로에 아예 진입하지 못한다(#103). 숫자를 앞에 요구하므로
 * "조례"·"조문" 같은 단어와는 충돌하지 않는다.
 */
const ARTICLE_RE = /제?\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g

/** 조문 뒤에 붙는 항/호 (조문 조회 파라미터는 아니지만 법령명에서는 걷어내야 한다) */
const ARTICLE_TAIL_RE = /제?\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제?\s*\d+\s*항)?(?:\s*제?\s*\d+\s*호)?/g

/** "제38조" / "제10조의2" 정규 표기로 변환 */
function formatArticle(no: string, sub?: string): string {
  return sub ? `제${no}조의${sub}` : `제${no}조`
}

/** 쿼리에 등장하는 조문번호 전부 (등장 순서, 중복 제거) */
export function extractArticleNumbers(query: string): string[] {
  const found: string[] = []
  for (const m of query.matchAll(ARTICLE_RE)) {
    const jo = formatArticle(m[1], m[2])
    if (!found.includes(jo)) found.push(jo)
  }
  return found
}

/** 첫 번째 조문번호 (없으면 undefined) */
export function extractArticleNumber(query: string): string | undefined {
  return extractArticleNumbers(query)[0]
}

/** "별표28", "별표 1의2" → "28" / "1의2" (없으면 undefined) */
export function extractAnnexNo(query: string): string | undefined {
  const m = query.match(/별표\s*(\d+(?:\s*의\s*\d+)?)/)
  return m ? m[1].replace(/\s+/g, "") : undefined
}

/** 판결문·법령 전문(축약 해제)을 요구하는 표현인지 */
export function wantsFullText(query: string): boolean {
  return /전문|전체\s*본문|풀\s*텍스트|축약\s*(?:없이|해제)/.test(query)
}

// ────────────────────────────────────────
// 후행 의도 어휘 — specific_article 양보 판단용 (#99)
// ────────────────────────────────────────

/** 인용 검증 의도 ("검증", "맞는지 봐줘") */
export const INTENT_VERIFY = /검증|맞는지|맞나요?|사실인지|실존|인용\s*(?:확인|체크)/

/** 비교 의도 — 단독 "비교"는 너무 넓어 3단비교·신구대조·vs·차이만 잡는다 */
export const INTENT_COMPARE = /3단\s*비교|신구\s*?대조|\bvs\.?\b|차이|다른\s*점/i

/** 판례 의도 */
export const INTENT_PRECEDENT = /판례|판결|인용한/

/** 개정 이력 의도 */
export const INTENT_HISTORY = /개정|연혁|이력/

/** 조문번호 뒤에 붙은 "다른 의도"가 있는가 — 있으면 조문 단독 조회로 축소하지 않는다 */
export function hasFollowOnIntent(query: string): boolean {
  return INTENT_VERIFY.test(query) ||
    INTENT_COMPARE.test(query) ||
    INTENT_PRECEDENT.test(query) ||
    INTENT_HISTORY.test(query)
}

/**
 * 쿼리에서 순수 법령명만 추출.
 *
 * 주의: replace 순서에 의존하지 않도록 한 번에 처리.
 * "등록면허세법"처럼 법령명 자체에 키워드가 포함된 경우 파괴하지 않기 위해
 * 단어 경계(\b에 해당하는 한글 패턴)를 고려하여 제거.
 */
export function extractLawName(query: string): string {
  return query
    // 조문번호(+항/호) — 확정적 구문이라 먼저 제거
    .replace(ARTICLE_TAIL_RE, " ")
    // "별표 1", "별표" 등 독립적 사용만 제거
    .replace(/별표\s*\d*(?:\s*의\s*\d+)?/g, "")
    // 뒤 경계는 lookahead(소비 안 함) — 소비하면 "개정 연혁"처럼 연속 키워드의 두 번째가 살아남음
    .replace(/(?:^|\s)(판례|판결|사례|대법원|헌재|행정심판)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(해석례?|유권해석|질의회신)(?=\s|$)/g, " ")
    // "개정된"처럼 어미가 붙은 형태까지 (남으면 검색어를 오염시킨다)
    .replace(/(?:^|\s)(개정|이력|변경|연혁|신구대조)(?:된|한|되는|하는)?(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(3단비교|위임|인용|체계)(?=\s|$)/g, " ")
    .replace(/(?:^|\s)(영문|영어|English)(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)(서식|양식|별지|신청서)(?=\s|$)/g, " ")
    // 조례/규칙은 법령명 일부이므로 유지
    // 동사형 수식어 제거
    .replace(/(?:^|\s)(검색|조회|확인|검증|알려줘|찾아줘|보여줘|검증해줘)(?=\s|$)/g, " ")
    // 조문 나열의 가운뎃점이 홀로 남는 경우 정리 ("민법 제309조·제310조" → "민법 ·")
    .replace(/\s*[·•]\s*/g, " ")
    // 정리
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * 절차/비용 의도가 처분/허가 의도보다 강한지 판단.
 * "신고 방법", "허가 절차 수수료" 같은 복합 쿼리에서
 * 절차 키워드가 있으면 procedure를 우선.
 */
export function hasProcedureIntent(query: string): boolean {
  return /절차|방법|수수료|과태료|비용|신청\s*방법|어떻게/.test(query)
}

/**
 * 자치법규 질의로 볼 수 있는 지역명인지.
 * "연구"·"요구"처럼 행정구역 접미사로 끝나는 일반 명사를 걸러낸다(#104).
 */
const NON_REGION_TOKENS = new Set([
  "연구", "요구", "청구", "지구", "추구", "촉구", "욕구", "탐구", "촉구",
  "도시", "고시", "공시", "명시", "표시", "제시", "예시", "감시", "무시",
  "장군", "학군",
])

export function isRegionToken(token: string): boolean {
  return !NON_REGION_TOKENS.has(token)
}
