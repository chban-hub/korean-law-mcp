/**
 * 시점 비교의 "지금" 쪽 어휘 (#144 후속)
 *
 * 두 시점 비교에서 뒤쪽 시점을 가리키는 말은 한 벌이어야 한다.
 * `현행`은 되고 `올해`·`오늘`은 안 되면, 같은 질문이 표현만 바꿔도 다른 도구로 간다.
 */
import { describe, it, expect } from "vitest"
import { routeQuery } from "./query-router.js"
import { extractTimeTravel } from "./query-extract.js"
import { RELATIVE_NOW_WORDS } from "./date-patterns.js"

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

describe("두 시점 비교 — 지금 쪽 어휘가 표현에 따라 갈리지 않는다", () => {
  it("현행·지금·현재·오늘·올해가 모두 시점 비교로 간다", () => {
    for (const now of RELATIVE_NOW_WORDS.split("|")) {
      const q = `관세법 2024 vs ${now}`
      const r = routeQuery(q)
      expect([q, r.tool, r.params.scenario]).toEqual([q, "chain_amendment_track", "time_travel"])
    }
  })

  it("'부터 ~까지' 어순도 같은 어휘 집합을 받는다", () => {
    const r = routeQuery("관세법 2024부터 올해까지")
    expect([r.tool, r.params.scenario]).toEqual(["chain_amendment_track", "time_travel"])
  })

  it("뒤쪽 시점이 '지금'이면 toDate 는 오늘이다", () => {
    for (const now of RELATIVE_NOW_WORDS.split("|")) {
      const p = extractTimeTravel(`관세법 2024 vs ${now}`)
      expect([now, p.fromDate, p.toDate]).toEqual([now, "20240101", today()])
    }
  })
})

describe("어휘 원본이 한 벌이다", () => {
  it("판정에 쓰는 어휘가 date-patterns 선언과 어긋나지 않는다", () => {
    // 어느 한쪽에만 말을 더하면 같은 질문이 표현에 따라 다른 도구로 간다
    for (const now of RELATIVE_NOW_WORDS.split("|")) {
      expect([now, routeQuery(`관세법 2020 vs ${now}`).tool])
        .toEqual([now, "chain_amendment_track"])
    }
  })
})
