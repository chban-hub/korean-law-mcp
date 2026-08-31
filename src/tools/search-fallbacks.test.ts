/**
 * 지적 6 — 폴백 사다리의 지역 판정이 #104 블랙리스트를 안다.
 *
 * "행정구역 접미사로 끝나는 일반 명사"(재청구·선거구)를 걸러내는 지식이
 * query-extract 에만 살고 있어, 법령 0건일 때 "재청구 절차"가 자치법규 폴백을
 * 타고 `[FALLBACK] … 자치법규로 자동 폴백` 안내를 달았다.
 */
import { describe, it, expect } from "vitest"
import { looksLikeOrdinanceQuery } from "./search-fallbacks.js"
import { isRegionToken } from "../lib/query-extract.js"

describe("looksLikeOrdinanceQuery", () => {
  it.each(["재청구 절차", "선거구 획정 기준", "연구 지원", "학군 조정"])(
    "행정구역 접미사를 단 일반 명사 %s 는 자치법규 질의가 아니다",
    (q) => { expect(looksLikeOrdinanceQuery(q)).toBe(false) }
  )

  it.each(["광진구 복무 조례", "서울시 주차", "성남시 주차장", "완주군 조례"])(
    "실제 지역명 %s 는 자치법규 질의다",
    (q) => { expect(looksLikeOrdinanceQuery(q)).toBe(true) }
  )

  it("판정 어휘를 두 벌로 갖지 않는다 — isRegionToken 이 단일 원본", () => {
    // 블랙리스트에 낱말이 늘면 폴백 판정도 같이 좁아져야 한다.
    for (const token of ["재청구", "선거구", "학군"]) {
      expect([token, isRegionToken(token)]).toEqual([token, false])
      expect([token, looksLikeOrdinanceQuery(`${token} 기준`)]).toEqual([token, false])
    }
  })
})
