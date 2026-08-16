import { describe, it, expect } from "vitest"
import { extractCitedLaws } from "./impact-buckets.js"

describe("extractCitedLaws — 인용 법령 접미 (#139)", () => {
  it("법·법률·시행령·시행규칙·규칙·규정을 읽는다", () => {
    expect(extractCitedLaws("「건설기계관리법」 제26조에 따른다")).toEqual(["건설기계관리법"])
    expect(extractCitedLaws("「개인정보 보호법 시행령」 제5조")).toEqual(["개인정보 보호법 시행령"])
    expect(extractCitedLaws("「형사소송규칙」 제3조")).toEqual(["형사소송규칙"])
  })

  // impact_map의 5개 버킷 중 하나가 자치법규다. 접미 목록에 조례가 없어서
  // 조문 본문이 인용한 조례가 그래프의 "인용 법령"에서 통째로 빠졌다.
  it("조례도 인용 법령으로 읽는다", () => {
    expect(extractCitedLaws("「서울특별시 주차장 조례」 제5조에 따라"))
      .toEqual(["서울특별시 주차장 조례"])
    expect(extractCitedLaws("「민법」과 「동해시 시민법률상담 운영 조례」를 본다"))
      .toEqual(["민법", "동해시 시민법률상담 운영 조례"])
  })

  it("낫표 밖 텍스트는 줍지 않는다", () => {
    expect(extractCitedLaws("민법 제103조에 따른다")).toEqual([])
  })
})
