import { describe, it, expect } from "vitest"
import { bucketLine, extractCitedLaws, parseBucket } from "./impact-buckets.js"
import { parseArticleAnchor } from "./article-anchor.js"

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

// #150: excluded가 조문 불일치+타 법령 합산 단일 카운터라 문구가 전부
// "조문 불일치 N건 제외"로 나갔다 — 타 법령 제외가 조문 문제로 둔갑한 오표기.
describe("제외 사유 축 구분 (#150)", () => {
  it("parseBucket은 조문 불일치와 다른 법령을 따로 센다", () => {
    const text = [
      "헌재 결정례 (총 3건):", "",
      "[1] 민법 제1032조 위헌소원", "사건번호: 2024헌바107", "",
      "[2] 상법 제103조 위헌소원", "사건번호: 2010헌바99", "",
      "[3] 민법 제103조 위헌소원", "사건번호: 2007헌바12", "",
    ].join("\n")
    const stat = parseBucket({ text, isError: false }, parseArticleAnchor("제103조", "민법")!, 5)
    expect(stat.verified).toBe(1)
    expect(stat.excludedArticle).toBe(1)   // [1] 제1032조
    expect(stat.excludedLaw).toBe(1)       // [2] 상법
  })

  it("bucketLine은 두 축을 나눠 적고, 없는 축은 언급하지 않는다", () => {
    const base = { verified: 3, searchCount: 5, topItems: [], covered: true, lawConfirmed: 2, lawHeld: 1 }
    expect(bucketLine({ ...base, excludedArticle: 2, excludedLaw: 1 }))
      .toContain("(조문 불일치 2건·다른 법령 1건 제외)")
    expect(bucketLine({ ...base, excludedArticle: 0, excludedLaw: 1 }))
      .toContain("(다른 법령 1건 제외)")
    expect(bucketLine({ ...base, excludedArticle: 0, excludedLaw: 1 })).not.toContain("조문 불일치")
  })
})
