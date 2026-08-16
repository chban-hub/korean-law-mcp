import { describe, it, expect } from "vitest"
import { extractCaseNumbers, isImpossibleCaseNumber } from "./case-citation.js"

describe("extractCaseNumbers — 사건번호 인용 추출 (#93)", () => {
  it("법령 인용과 섞인 문장에서 사건번호를 뽑는다", () => {
    expect(extractCaseNumbers("민법 제999조의9와 대법원 2099다99999 판결에 따르면 가능하다."))
      .toEqual(["2099다99999"])
  })

  it("표준 판결 인용 표기를 받는다", () => {
    expect(extractCaseNumbers("대법원 2018. 10. 30. 선고 2013다61381 전원합의체 판결"))
      .toEqual(["2013다61381"])
    expect(extractCaseNumbers("96누4671, 2010두28604")).toEqual(["96누4671", "2010두28604"])
    expect(extractCaseNumbers("헌재 2024헌바107")).toEqual(["2024헌바107"])
  })

  it("조문 인용을 사건번호로 오인하지 않는다", () => {
    expect(extractCaseNumbers("민법 제999조의9")).toEqual([])
    expect(extractCaseNumbers("민법 제103조 제1항 제2호")).toEqual([])
    expect(extractCaseNumbers("상법 제401조의2 제2항 제3호")).toEqual([])
  })

  it("연도·날짜·수량 표기를 사건번호로 오인하지 않는다", () => {
    expect(extractCaseNumbers("2023. 5. 10. 시행")).toEqual([])
    expect(extractCaseNumbers("1970년대 30명")).toEqual([])
    expect(extractCaseNumbers("총 20건 3개")).toEqual([])
  })

  it("수량 표기 뒤에 오는 진짜 사건번호는 살린다", () => {
    expect(extractCaseNumbers("2024년 2013다61381 판결")).toEqual(["2013다61381"])
  })

  it("중복은 1회만", () => {
    expect(extractCaseNumbers("2013다61381 및 2013다61381")).toEqual(["2013다61381"])
  })
})

describe("isImpossibleCaseNumber — 구조적으로 불가능한 사건번호", () => {
  it("미래 연도 사건번호는 실존 불가", () => {
    expect(isImpossibleCaseNumber("2099다99999", 2026)).toBe(true)
  })

  it("과거·현재 연도는 판단하지 않는다", () => {
    expect(isImpossibleCaseNumber("2013다61381", 2026)).toBe(false)
    expect(isImpossibleCaseNumber("2026다1", 2026)).toBe(false)
    expect(isImpossibleCaseNumber("96누4671", 2026)).toBe(false)
  })
})
