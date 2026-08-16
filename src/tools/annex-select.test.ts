import { describe, expect, it } from "vitest"
import { annexQueryKeywords, filterByAnnexQuery, type AnnexItem } from "./annex-select.js"
import { parseLawNameAndHint } from "../lib/annex-notation.js"

// 도로교통법 시행규칙 별표 목록 실측 발췌 (총 263건 중)
const LIST: AnnexItem[] = [
  { 별표번호: "012800", 별표명: "(강사, 기능검정원)자격증 기재사항 변경 신청서", 별표종류: "서식" },
  { 별표번호: "002800", 별표명: "운전면허 취소·정지처분 기준", 별표종류: "별표" },
  { 별표번호: "002600", 별표명: "운전면허 결격기간", 별표종류: "별표" },
  { 별표번호: "000600", 별표명: "과태료 부과기준", 별표종류: "별표" },
]

describe("annexQueryKeywords (#94)", () => {
  it("번호 힌트는 키워드에서 뺀다 (selector가 따로 쓴다)", () => {
    expect(annexQueryKeywords("별표28 운전면허")).toEqual(["운전면허"])
  })

  it("가운뎃점으로 이어진 표기도 토큰으로 나눈다", () => {
    expect(annexQueryKeywords("운전면허 취소·정지")).toEqual(["운전면허", "취소", "정지"])
  })

  it("query가 없으면 빈 배열", () => {
    expect(annexQueryKeywords(undefined)).toEqual([])
  })
})

describe("filterByAnnexQuery (#94)", () => {
  it("서로 다른 query는 서로 다른 결과로 좁혀진다", () => {
    const a = filterByAnnexQuery(LIST, "운전면허 취소")
    const b = filterByAnnexQuery(LIST, "과태료")
    expect(a.list.map((x) => x.별표번호)).toEqual(["002800"])
    expect(b.list.map((x) => x.별표번호)).toEqual(["000600"])
    expect(a.list).not.toEqual(b.list)
  })

  it("키워드를 모두 만족해야 한다 (AND)", () => {
    // '운전면허' 하나만으로는 2건이지만 '취소'까지 걸면 1건
    expect(filterByAnnexQuery(LIST, "운전면허").list).toHaveLength(2)
    expect(filterByAnnexQuery(LIST, "운전면허 취소").list).toHaveLength(1)
  })

  it("일치 0건이면 전체를 돌려주되 matched=false로 알린다", () => {
    const r = filterByAnnexQuery(LIST, "존재하지않는키워드")
    expect(r.matched).toBe(false)
    expect(r.list).toHaveLength(LIST.length)
  })

  it("query 미지정이면 목록을 건드리지 않는다", () => {
    const r = filterByAnnexQuery(LIST, undefined)
    expect(r.list).toBe(LIST)
    expect(r.matched).toBe(true)
  })
})

describe("query의 번호 힌트 (#94)", () => {
  it("'별표28'에서 선택값 28을 뽑는다", () => {
    expect(parseLawNameAndHint("별표28").annexNo).toBe("28")
  })

  it("'별표 1의2'는 6자리 코드로 변환한다", () => {
    expect(parseLawNameAndHint("별표 1의2").annexNo).toBe("000102")
  })
})
