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

  // 자기리뷰 지적: 부호를 음절 블랙리스트로 거르면 실존 부호를 조용히 놓친다.
  // 회생(회합·회단)·가정보호(호)는 실존 사건부호이므로 제외 대상이 아니다.
  it("회생·가정보호 등 덜 흔한 사건부호도 놓치지 않는다", () => {
    expect(extractCaseNumbers("서울회생법원 2019회단100123 결정")).toEqual(["2019회단100123"])
    expect(extractCaseNumbers("서울회생법원 2020회합100 결정")).toEqual(["2020회합100"])
    expect(extractCaseNumbers("2019호1234")).toEqual(["2019호1234"])
    expect(extractCaseNumbers("1988다카12345")).toEqual(["1988다카12345"])
    expect(extractCaseNumbers("2020즈합50")).toEqual(["2020즈합50"])
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
    expect(extractCaseNumbers("제3회 대회 20명")).toEqual([])
    expect(extractCaseNumbers("판례집 20-2, 300쪽")).toEqual([])
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
