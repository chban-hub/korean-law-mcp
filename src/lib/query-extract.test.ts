/**
 * query-extract 추출기 회귀 (PR #150 결함 2 · 결함 3 보강)
 *
 * extractTimeTravel 의 접속어 걷어내기가 법령명 내부 음절을 자르던 결함과,
 * 상대 과거("작년이랑")가 fromDate 없이 남아 시나리오가 오류 안내로 끝나던 공백.
 */
import { describe, it, expect } from "vitest"
import { extractTimeTravel } from "./query-extract.js"

describe("결함2 — 접속어 제거가 법령명 내부를 절단하지 않는다", () => {
  it("'과' 를 품은 법령명이 보존된다", () => {
    expect(extractTimeTravel("과학기술기본법 2024 vs 2026").query).toBe("과학기술기본법")
    expect(extractTimeTravel("성과평가법 2024 vs 올해").query).toBe("성과평가법")
  })

  it("시점 토큰에 붙었던 조사·접속어는 여전히 걷어낸다", () => {
    expect(extractTimeTravel("관세법 2024와 2026 비교").query).toBe("관세법")
    expect(extractTimeTravel("관세법 2024년과 2025년 차이").query).toBe("관세법")
    expect(extractTimeTravel("관세법 2024부터 2026까지").query).toBe("관세법")
    expect(extractTimeTravel("민법 작년이랑 지금 뭐가 달라").query).toBe("민법")
  })

  it("날짜 파라미터 추출은 그대로다", () => {
    const p = extractTimeTravel("과학기술기본법 2024 vs 2026")
    expect([p.fromDate, p.toDate]).toEqual(["20240101", "20260101"])
  })
})

describe("결함3 보강 — 상대 과거 시점이 fromDate 로 완결된다", () => {
  it("'작년이랑 지금' 이 fromDate 없이 남지 않는다", () => {
    const p = extractTimeTravel("민법 작년이랑 지금 뭐가 달라")
    expect(p.fromDate).toBe(`${new Date().getFullYear() - 1}0101`)
    expect(String(p.toDate)).toMatch(/^\d{8}$/)
  })

  it("'재작년' 은 2년 전 연초다", () => {
    const p = extractTimeTravel("민법 재작년이랑 현재 비교")
    expect(p.fromDate).toBe(`${new Date().getFullYear() - 2}0101`)
  })

  it("명시 연도가 있으면 상대 어휘보다 우선한다", () => {
    expect(extractTimeTravel("관세법 2024 vs 올해").fromDate).toBe("20240101")
  })
})
