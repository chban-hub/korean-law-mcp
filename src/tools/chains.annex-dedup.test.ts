/**
 * 체인 별표 중복 제거 (#131)
 *
 * penalty 시나리오는 같은 법령의 별표(처분기준표)를 이미 싣는다.
 * 체인이 또 받으면 같은 파일을 두 번 내려받아 파싱하고(실측 3.0초) 같은 표가 두 번 나온다.
 */
import { describe, it, expect } from "vitest"
import { shouldFetchAnnexSeparately } from "./chains.js"

describe("#131 별표 중복 판정", () => {
  it("penalty 시나리오가 붙으면 체인은 별표를 따로 받지 않는다", () => {
    expect(shouldFetchAnnexSeparately(["annex_fee"], "penalty")).toBe(false)
    expect(shouldFetchAnnexSeparately(["annex_table"], "penalty")).toBe(false)
  })

  it("시나리오가 없으면 체인이 별표를 받는다", () => {
    expect(shouldFetchAnnexSeparately(["annex_fee"], null)).toBe(true)
    expect(shouldFetchAnnexSeparately(["annex_table"], null)).toBe(true)
  })

  it("별표를 싣지 않는 다른 시나리오는 영향받지 않는다", () => {
    expect(shouldFetchAnnexSeparately(["annex_fee"], "customs")).toBe(true)
  })

  it("별표 확장 신호가 없으면 애초에 받지 않는다", () => {
    expect(shouldFetchAnnexSeparately([], null)).toBe(false)
    expect(shouldFetchAnnexSeparately(["precedent"], null)).toBe(false)
  })
})
