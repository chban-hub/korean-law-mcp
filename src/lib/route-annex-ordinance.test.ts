import { describe, expect, it } from "vitest"
import { routeQuery } from "./query-router.js"

// 자치법규 별표 처리(ordinbyl 분기 · filterByRelatedLawName · 서울특별시 건축 조례의
// [별표4]/[별지 제4호서식] 번호 충돌 사례)는 갖춰져 있는데, 그리로 가는 자연어 문만
// 닫혀 있었다 — 법령명 접미에 `조례`가 없어 별표 의도가 통째로 사라졌다(N6).
describe("조례 별표 질의 라우팅 (N6)", () => {
  it("'서울특별시 건축 조례 별표 4' → get_annexes", () => {
    const r = routeQuery("서울특별시 건축 조례 별표 4")
    expect(r?.tool).toBe("get_annexes")
    expect(String(r?.params.lawName)).toContain("조례")
    expect(r?.params.annexNo).toBe("4")
  })

  it("별지 서식 표기도 조례에서 동작한다", () => {
    const r = routeQuery("서울특별시 건축 조례 별지 제4호서식")
    expect(r?.tool).toBe("get_annexes")
    expect(r?.params.annexNo).toBe("4")
  })

  it("조문이 끼어도 별표 의도가 이긴다", () => {
    const r = routeQuery("광진구 주차 조례 제5조 별표 2")
    expect(r?.tool).toBe("get_annexes")
    expect(r?.params.annexNo).toBe("2")
  })

  it("별표가 없는 조례 질의는 그대로 자치법규 검색 (회귀)", () => {
    expect(routeQuery("서울시 주차 조례")?.tool).toBe("search_ordinance")
    expect(routeQuery("광진구 복무 조례")?.tool).toBe("search_ordinance")
  })

  it("법령 별표 라우팅은 그대로 (회귀)", () => {
    expect(routeQuery("도로교통법 시행규칙 별표 28")?.tool).toBe("get_annexes")
  })
})
