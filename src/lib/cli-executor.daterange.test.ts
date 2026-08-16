/**
 * dateRange 주입 가드 (PR #150 결함 3)
 *
 * "관세법 2024 vs 올해" — 라우팅(time_travel)이 뽑은 fromDate=20240101 위에
 * '올해' 날짜 규칙의 범위(그해 0101~1231)가 주입되면 2024 앵커가 파괴된다.
 * 주입은 빈 자리만 채워야 한다.
 */
import { describe, it, expect } from "vitest"
import { routeQuery } from "./query-router.js"
import { applyDateRange } from "./cli-executor.js"

describe("결함3 — dateRange 주입이 이미 뽑힌 fromDate/toDate 를 덮지 않는다", () => {
  it("time_travel 이 뽑은 앵커가 보존된다", () => {
    const route = routeQuery("관세법 2024 vs 올해")
    // 전제: 라우팅이 앵커를 뽑았고, '올해' 규칙의 dateRange 도 붙어 있다
    expect(route.params.fromDate).toBe("20240101")
    expect(route.dateRange).toBeDefined()
    const toBefore = route.params.toDate
    applyDateRange(route)
    expect(route.params.fromDate).toBe("20240101")
    expect(route.params.toDate).toBe(toBefore)
  })

  it("빈 자리는 dateRange 로 채운다 (기존 주입 동작 유지)", () => {
    const route = routeQuery("최근 3년 음주운전 판례")
    expect(route.params.fromDate).toBeUndefined()
    applyDateRange(route)
    expect([route.params.fromDate, route.params.toDate])
      .toEqual([route.dateRange!.from, route.dateRange!.to])
  })

  it("dateRange 없는 라우팅은 그대로다", () => {
    const route = routeQuery("민법 제103조")
    applyDateRange(route)
    expect(route.params.fromDate).toBeUndefined()
  })
})
