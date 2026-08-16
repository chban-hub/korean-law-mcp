import { describe, expect, it } from "vitest"
import { annexDelegatingArticles, filterByArticle, normalizeArticleLabel } from "./annex-select.js"
import type { AnnexItem } from "./annex-select.js"

// 조문 동반 별표 질의("관세법 제38조 별표 2")가 annex 경로로 오면서도 조문 슬롯이 없어
// 위임 맥락이 소실됐다(#133). 법제처 별표명은 근거 조문을 괄호로 달고 온다.
const item = (name: string, no: string): AnnexItem => ({ 별표번호: no, 별표명: name, 별표종류: "별표" })

const LIST: AnnexItem[] = [
  item("관세율표(제38조 관련)", "000200"),
  item("수수료 및 사무의 대행에 드는 비용(제39조 관련)", "000300"),
  item("과태료의 부과기준(제277조의2 관련)", "000400"),
  item("번호 없는 별표", "000500"),
]

describe("annexDelegatingArticles", () => {
  it("별표명의 위임 조문 표기를 읽는다", () => {
    expect(annexDelegatingArticles(LIST[0])).toEqual(["제38조"])
    expect(annexDelegatingArticles(LIST[2])).toEqual(["제277조의2"])
    expect(annexDelegatingArticles(LIST[3])).toEqual([])
  })

  it("HTML 태그가 섞여도 읽는다", () => {
    expect(annexDelegatingArticles(item("<b>관세율표</b>(제38조 관련)", "1"))).toEqual(["제38조"])
  })
})

describe("normalizeArticleLabel", () => {
  it("여러 표기를 정규 표기로 모은다", () => {
    expect(normalizeArticleLabel("38")).toBe("제38조")
    expect(normalizeArticleLabel("제38조")).toBe("제38조")
    expect(normalizeArticleLabel("277조의2")).toBe("제277조의2")
  })
})

describe("filterByArticle", () => {
  it("그 조문이 위임한 별표로 좁힌다", () => {
    const r = filterByArticle(LIST, "제38조")
    expect(r.matched).toBe(true)
    expect(r.list.map((a) => a.별표번호)).toEqual(["000200"])
    expect(r.article).toBe("제38조")
  })

  it("jo 없이는 목록을 건드리지 않는다", () => {
    expect(filterByArticle(LIST).list).toBe(LIST)
  })

  // 조용히 0건을 주면 "그런 별표는 없다"는 오답이, 조용히 전체를 주면
  // "그 조문이 위임한 별표"라는 오독이 된다 — filterByAnnexQuery 와 같은 계약.
  it("못 맞히면 전체를 돌려주되 matched=false 로 알린다", () => {
    const r = filterByArticle(LIST, "제999조")
    expect(r.matched).toBe(false)
    expect(r.list).toBe(LIST)
    expect(r.article).toBe("제999조")
  })
})
