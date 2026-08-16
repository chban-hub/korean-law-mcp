import { describe, it, expect } from "vitest"
import { buildCompactLegalQueries } from "./compact-query-planner.js"

function caseNumberOf(query: string): string | undefined {
  return buildCompactLegalQueries({ originalQuery: query, max: 8 })
    .find(c => c.source === "case_number")?.query
}

describe("buildCompactLegalQueries — 사건부호 인식 (#125)", () => {
  it("종전부터 읽던 부호는 그대로 읽는다", () => {
    expect(caseNumberOf("2013다61381 판결 알려줘")).toBe("2013다61381")
    expect(caseNumberOf("2020두12345 사건")).toBe("2020두12345")
    expect(caseNumberOf("2019고합100 판결")).toBe("2019고합100")
    expect(caseNumberOf("2018헌바317 결정")).toBe("2018헌바317")
  })

  // CASE_CODE_PATTERN이 가사(므)·특허(후/허)·재심(재)을 빠뜨려 사건번호로 인식되지 않았다.
  it("가사·특허·재심 부호도 사건번호로 읽는다", () => {
    expect(caseNumberOf("2020므1234 이혼 판결")).toBe("2020므1234")
    expect(caseNumberOf("2019후1234 특허 판결")).toBe("2019후1234")
    expect(caseNumberOf("2019허5678 특허법원 판결")).toBe("2019허5678")
    expect(caseNumberOf("2021재고합10 재심 판결")).toBe("2021재고합10")
  })

  it("가사 나머지 부호(드·르·브·스·즈)도 읽는다", () => {
    expect(caseNumberOf("2020드단1111 판결")).toBe("2020드단1111")
    expect(caseNumberOf("2020르2222 판결")).toBe("2020르2222")
    expect(caseNumberOf("2020스333 결정")).toBe("2020스333")
  })

  it("사건번호가 아닌 연도 표현은 사건번호로 만들지 않는다", () => {
    expect(caseNumberOf("2020년 근로계약 해지 판례")).toBeUndefined()
    expect(caseNumberOf("2019 임금체불 손해배상")).toBeUndefined()
  })
})
