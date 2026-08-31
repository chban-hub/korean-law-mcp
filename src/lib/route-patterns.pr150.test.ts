/**
 * PR #150 리뷰 실측 결함 회귀 테스트 (라우팅 층)
 *
 * 2026-08-17 리뷰에서 실행으로 재현된 결함 중 라우팅 테이블 몫(1·4·5·6).
 * 결함 2(extractTimeTravel 절단)는 query-extract.test.ts,
 * 결함 3(dateRange 덮어쓰기)은 cli-executor.daterange.test.ts 가 고정한다.
 */
import { describe, it, expect } from "vitest"
import { routeQuery } from "./query-router.js"

function reached(query: string): string[] {
  const r = routeQuery(query)
  return [r.tool, ...(r.pipeline ?? []).map(p => p.tool)]
}

const mainQuery = (q: string) => routeQuery(q).params.query

describe("결함1 — 양보 사이를 statistics 가 가로채 query 를 버리지 않는다", () => {
  it("'최근 개정된 + 법령명 + 조문' 이 개정추적으로 간다 (법령명·조문 소실 금지)", () => {
    const r = routeQuery("최근 개정된 근로기준법 제60조")
    expect(r.tool).toBe("chain_amendment_track")
    expect(String(r.params.query)).toContain("근로기준법")
  })

  it("'최근 개정된 + 법령명' 도 그 법령의 개정 이력이다", () => {
    const r = routeQuery("최근 개정된 근로기준법")
    expect(r.tool).toBe("chain_amendment_track")
    expect(String(r.params.query)).toContain("근로기준법")
  })

  it("법령 지목 없는 통계 질의는 그대로 통계다", () => {
    for (const q of ["법령 통계", "최근 개정 현황", "최근 개정 법령 통계 보여줘"]) {
      expect([q, routeQuery(q).tool]).toEqual([q, "get_law_statistics"])
    }
  })
})

describe("결함4 — 시/군/구로 끝나는 일반 명사를 지역명으로 읽지 않는다", () => {
  it.each([
    "지역구 사무실 운영 규정",
    "놀이기구 안전 검사 규정",
    "대학입시 전형 위원회 규정",
  ])("'%s' 는 자치법규 검색으로 가지 않는다", (q) => {
    expect(reached(q)).not.toContain("search_ordinance")
  })

  it("실제 지자체 질의는 그대로 자치법규다 (#104 유지)", () => {
    expect(reached("광진구 공무원 휴직 규정")).toContain("search_ordinance")
  })
})

describe("결함5 — 대법원·판례를 명시한 질의는 심판 구획이 가로채지 않는다 (#129 양방향)", () => {
  it("행정심판 문맥이라도 '대법원 판례' 명시는 판례 검색으로 간다", () => {
    expect(reached("행정심판 재결 취소 대법원 판례")).toContain("search_precedents")
    expect(mainQuery("행정심판 재결 취소 대법원 판례")).toBe("행정심판 재결 취소")
  })

  it("조세심판 문맥도 마찬가지다", () => {
    expect(reached("조세심판 불복 대법원 판례")).toContain("search_precedents")
  })

  it("#129 원방향 유지 — 심판례 합성어는 심판례 검색에 남는다", () => {
    expect(reached("행정심판례 건축허가")).toContain("search_admin_appeals")
    expect(reached("조세심판례 부가세")).toContain("search_tax_tribunal_decisions")
  })

  it("판례 어휘 없는 행정심판 질의는 그대로다", () => {
    expect(reached("행정심판 사례 분석")).toContain("search_admin_appeals")
  })
})

describe("결함6 — 결정례/결정문 strip 이 고아 음절을 남기지 않는다", () => {
  it("'결정문' 이 '문' 으로 잘리지 않는다 (헌재·조세심판)", () => {
    // 트리거가 곧 질의 전부면 원문 폴백(#119)이 정답이다 — 고아 '문'이 아니라
    expect(mainQuery("헌재 결정문")).toBe("헌재 결정문")
    expect(mainQuery("조세심판원 결정문 부가세")).toBe("부가세")
  })

  it("'결정례' 가 '례' 로 잘리지 않는다 (공정위·개인정보위·노동위)", () => {
    expect(mainQuery("공정위 결정례 담합")).toBe("담합")
    expect(mainQuery("개인정보위 결정례 유출")).toBe("유출")
    expect(mainQuery("노동위 결정례 부당해고")).toBe("부당해고")
  })

  it("'조세심판례' 합성어도 '례' 를 남기지 않는다", () => {
    expect(mainQuery("조세심판례 부가세")).toBe("부가세")
  })

  it("기존 폴백 동작 유지 — 트리거만 남으면 원문이다", () => {
    expect(mainQuery("헌법재판소 결정")).toBe("헌법재판소 결정")
    expect(mainQuery("중앙노동위원회 결정문")).toBe("중앙노동위원회 결정문")
  })
})
