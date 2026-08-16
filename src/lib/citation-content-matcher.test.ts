import { describe, it, expect } from "vitest"
import { matchCitationContent, normalizeLegalText } from "./citation-content-matcher.js"

describe("matchCitationContent", () => {
  it("동일 제목은 match", () => {
    expect(matchCitationContent("불법행위", "불법행위").matched).toBe(true)
  })

  it("짧은 claim이 실제 제목에 포함되면 match", () => {
    expect(matchCitationContent("불법행위", "불법행위의 내용").matched).toBe(true)
  })

  it("조사/어미 차이는 bigram jaccard로 흡수", () => {
    expect(matchCitationContent("손해배상책임", "손해배상의 책임").matched).toBe(true)
  })

  it("전혀 다른 제목은 mismatch (환각 탐지)", () => {
    const r = matchCitationContent("계약의 해제", "불법행위")
    expect(r.matched).toBe(false)
    expect(r.method).toBe("mismatch")
  })

  it("빈 입력은 mismatch", () => {
    expect(matchCitationContent("", "불법행위").matched).toBe(false)
    expect(matchCitationContent("불법행위", "").matched).toBe(false)
  })
})

describe("normalizeLegalText", () => {
  it("원문자 → 괄호숫자", () => {
    expect(normalizeLegalText("①항")).toBe("(1)항")
  })

  // 상류(chrisryugj/lexdiff@f15d400)는 이 파일에서만 ⑮에서 멈춘다(2026-08-17 대조).
  // 제16항 이상이 원문자로 남으면 정규화가 조용히 실패해 인용 대조(L1 substring /
  // L2 bigram)가 어긋난다 — 상류 확인 후 CIRCLED_DIGITS 단일 원본으로 확장 (#147).
  it("⑮ 경계를 넘어 제16항 이상도 변환한다", () => {
    expect(normalizeLegalText("⑮항")).toBe("(15)항")
    expect(normalizeLegalText("⑯항")).toBe("(16)항")
    expect(normalizeLegalText("⑳항")).toBe("(20)항")
    expect(normalizeLegalText("㊿항")).toBe("(50)항")
  })

  it("법명 홑화살괄호 제거", () => {
    expect(normalizeLegalText("「민법」")).toBe("민법")
  })

  it("NBSP는 일반 공백으로 정규화", () => {
    // U+00A0 (NBSP)를 코드포인트로 구성 — 소스에 제어문자 미포함
    const nbsp = String.fromCharCode(0x00a0)
    expect(normalizeLegalText(`손해${nbsp}배상`)).toBe("손해 배상")
  })
})
