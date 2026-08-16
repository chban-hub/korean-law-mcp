import { describe, expect, it } from "vitest"
import { containsHtmlMarkup, isBlankBody, isHtmlPage } from "./body-shape.js"
import { detectBadBody } from "./upstream-miss.js"

// 같은 질문에 세 곳이 서로 다른 술어로 답하고 있었다(#141):
// 재시도 계층은 앵커+대소문자 무시, api-client는 비앵커+대소문자 구분.
describe("isHtmlPage — 응답이 통째로 웹 페이지인가", () => {
  it("대소문자를 가리지 않는다 (소문자 doctype도 점검 페이지다)", () => {
    expect(isHtmlPage("<!DOCTYPE html><html><body>점검</body></html>")).toBe(true)
    expect(isHtmlPage("<!doctype html><html><body>점검</body></html>")).toBe(true)
    expect(isHtmlPage("<HTML><body>x</body></HTML>")).toBe(true)
  })

  it("앞쪽 공백은 무시한다", () => {
    expect(isHtmlPage("\n\n  <!DOCTYPE html><html></html>")).toBe(true)
  })

  it("정상 XML/JSON 본문에 <html 조각이 섞인 것은 점검 페이지가 아니다", () => {
    expect(isHtmlPage(`<?xml version="1.0"?><Law><![CDATA[<html>표</html>]]></Law>`)).toBe(false)
    expect(isHtmlPage(`{"Law":"<html>서식</html>"}`)).toBe(false)
  })
})

describe("isBlankBody", () => {
  it("빈 문자열과 공백만 있는 본문", () => {
    expect(isBlankBody("")).toBe(true)
    expect(isBlankBody("   \n\t ")).toBe(true)
    expect(isBlankBody("{}")).toBe(false)
  })
})

describe("containsHtmlMarkup — 내용 판정 (오류 판정과 다른 질문)", () => {
  it("조각이 어디에 있든 잡는다", () => {
    expect(containsHtmlMarkup("서식 본문 <body>표</body> 끝")).toBe(true)
    expect(containsHtmlMarkup("평문만 있는 에디터 blob")).toBe(false)
  })
})

describe("detectBadBody — 술어를 body-shape 하나에서 가져온다", () => {
  it("판정이 isBlankBody/isHtmlPage와 어긋나지 않는다", () => {
    const samples = [
      "",
      "   ",
      "<!doctype html><html></html>",
      "<!DOCTYPE html><html></html>",
      `<?xml version="1.0"?><Law>ok</Law>`,
      `{"Law":"ok"}`,
    ]
    for (const s of samples) {
      const expected = isBlankBody(s) ? "empty" : isHtmlPage(s) ? "html" : null
      expect(detectBadBody(s)).toBe(expected)
    }
  })
})
