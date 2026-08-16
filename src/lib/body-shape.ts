/**
 * 업스트림 응답 본문의 **겉모양** 판정 — 이 질문들에 답하는 곳은 여기 하나다.
 *
 * 같은 질문을 세 곳이 서로 다른 술어로 답하고 있었다(#141): 재시도 계층은 앵커 +
 * 대소문자 무시, `api-client`는 비앵커 + 대소문자 구분이라 소문자 `<!doctype html`로
 * 시작하는 본문이 한쪽에는 HTML이고 다른 쪽에는 아니었다. 갈라진 술어는 미스 판정과
 * 오류 메시지가 서로 다른 답을 내게 만든다.
 *
 * 아래 셋은 **서로 다른 질문**이라 하나로 합치지 않고 각각 이름을 준다. 합치면
 * "내용에 HTML이 섞였다"와 "응답이 통째로 웹 페이지다"가 같은 답을 받게 된다.
 */

/** 본문이 비었는가 — 공백만 있는 경우를 포함한다. */
export function isBlankBody(text: string): boolean {
  return !text || !text.trim()
}

/**
 * XML/JSON을 기대한 자리에 **웹 페이지가 통째로** 온 것인가 (점검·과부하·권한 안내 페이지).
 *
 * 앞부분 앵커로 본다. 비앵커 `includes`로 보면 정상 XML 본문의 CDATA 안에 `<html`이
 * 섞였을 때 점검 페이지로 오인한다 — 법령 본문은 그런 조각을 실어 나를 수 있다.
 * 대소문자는 무시한다: 실측된 DRF 안내 페이지는 `<!DOCTYPE html`로 오지만 그 표기에
 * 판정을 걸 이유가 없다.
 */
export function isHtmlPage(text: string): boolean {
  const t = text.trim()
  return /^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)
}

/**
 * 이 문자열이 HTML 마크업을 담고 있는가.
 *
 * 위 둘과 달리 **오류 판정이 아니라 내용 판정**이다 — 국세법령정보 에디터 blob이
 * 서식 있는 HTML인지 평문인지 가를 때 쓴다. 조각이 어디에 있든 상관없으므로
 * 앵커를 걸지 않는다.
 */
export function containsHtmlMarkup(text: string): boolean {
  return /<html[\s>]/i.test(text) || /<body[\s>]/i.test(text)
}
