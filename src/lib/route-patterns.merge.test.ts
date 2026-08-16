/**
 * 통합 배치가 만든 이음새 회귀 — 라우팅 ↔ 다른 클러스터의 단일 원본 (지적 1·2)
 *
 * 텍스트 충돌 없이 머지된 개념 충돌이라 빌드·타입체크가 잡지 못한다.
 * 여기서 고정하는 것은 "라우팅이 남의 단일 원본을 쓰는가"다.
 */
import { describe, it, expect } from "vitest"
import { routeQuery } from "./query-router.js"

describe("지적 1 — cite_check 라우팅이 case-citation 사건부호 목록을 쓴다", () => {
  // 자체 `[가-힣]{1,5}` 와일드카드는 "2023년 5"를 사건번호로 읽었다.
  // 어순 한쪽에만 `(?!년|월|일)` 가드가 있어 앞 어순은 통째로 새어나갔다.
  it.each([
    "2023년 5월 개정 변경됐어?",
    "2020년 3월 시행 폐기됐나",
    "2019년 12월 개정된 내용 뒤집혔나요",
    "2024 서울시 100 변경",
  ])("개정 이력 질의 %s 가 cite_check 로 끌려가지 않는다", (q) => {
    expect(routeQuery(q).tool).not.toBe("cite_check")
  })

  it.each([
    ["2013다61381 아직 유효해?", "2013다61381"],
    ["이 판례 아직 유효해? 2013다61381", "2013다61381"],
    ["2018두42559 인용 추적", "2018두42559"],
    ["96누4671 아직 유효한가요", "96누4671"],       // 2자리 연도 표기 (cite-check.ts 가 드는 예시)
    ["2024헌바107 폐기됐나", "2024헌바107"],
    ["2013 다 61381 변경됐어?", "2013다61381"],      // 표기 공백은 흡수한다
  ])("실제 사건번호 %s 는 그대로 cite_check 로 간다", (q, caseNumber) => {
    const r = routeQuery(q)
    expect([r.tool, r.params.caseNumber]).toEqual(["cite_check", caseNumber])
  })
})

describe("지적 2 — 별표 자연어 라우팅이 annex 표기 문법과 정합한다", () => {
  it("'별표 제28호' 를 번호로 읽는다 (법령명 오염 금지)", () => {
    const r = routeQuery("도로교통법 시행규칙 별표 제28호")
    expect([r.tool, r.params.lawName, r.params.annexNo])
      .toEqual(["get_annexes", "도로교통법 시행규칙", "28"])
  })

  it("번호 없는 별표 질의는 남은 키워드를 query 로 넘긴다 (#94 의 유일한 자연어 경로)", () => {
    const r = routeQuery("관세법 별표 운전면허 취소 기준")
    expect([r.tool, r.params.lawName, r.params.query])
      .toEqual(["get_annexes", "관세법", "운전면허 취소 기준"])
  })

  it.each([
    ["도로교통법 시행규칙 별표28", "도로교통법 시행규칙", "28"],
    ["도로교통법 시행규칙 별표 1의2", "도로교통법 시행규칙", "000102"],
    ["관세법 제38조 별표 2", "관세법", "2"],
  ])("기존 번호 표기 %s 는 그대로", (q, lawName, annexNo) => {
    const r = routeQuery(q)
    expect([r.tool, r.params.lawName, r.params.annexNo]).toEqual(["get_annexes", lawName, annexNo])
  })

  it("번호가 있으면 query 로 법령명을 다시 흘리지 않는다", () => {
    expect(routeQuery("도로교통법 시행규칙 별표28").params.query).toBeUndefined()
  })
})
