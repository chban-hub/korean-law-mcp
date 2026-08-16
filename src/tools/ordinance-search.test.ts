import { describe, it, expect } from "vitest"
import { searchOrdinance } from "./ordinance-search.js"
import type { LawApiClient } from "../lib/api-client.js"

const EMPTY = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>0</totalCnt><page>1</page></OrdinSearch>`
const HIT = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<law><자치법규일련번호>1800233</자치법규일련번호><자치법규명><![CDATA[강릉시 주차위반자동차 견인 등 소요비용산정 기준에 관한 조례]]></자치법규명>` +
  `<지자체기관명>강릉시</지자체기관명><공포일자>20200101</공포일자><시행일자>20200101</시행일자></law></OrdinSearch>`

/**
 * #117 실측 정정: 조번호를 버리는 것은 폴백이 아니라 **업스트림**이다.
 * `target=ordin`은 section=ordinNm(자치법규명)만 훑어서 "도로교통법 제148조의2"에도
 * 곧바로 158건을 돌려준다(폴백은 애초에 발동하지 않는다, 2026-08-17 실측).
 */
describe("searchOrdinance — 조문 번호 미반영 고지 (#117)", () => {
  it("질의에 조문 번호가 있으면 자치법규명 검색이 그것을 반영하지 못함을 밝힌다", async () => {
    const client = { searchOrdinance: async () => HIT } as unknown as LawApiClient
    const r = await searchOrdinance(client, { query: "도로교통법 제148조의2", display: 10 })
    const text = r.content[0].text
    expect(text).toMatch(/조문 번호/)
    expect(text).toMatch(/관련성|보장|반영/)
  })

  it("조문 번호가 없는 질의에는 고지를 붙이지 않는다", async () => {
    const client = { searchOrdinance: async () => HIT } as unknown as LawApiClient
    const r = await searchOrdinance(client, { query: "강릉시 견인 조례", display: 10 })
    expect(r.content[0].text).not.toMatch(/조문 번호/)
  })

  it("확장 질의로 결과를 냈으면 그 사실도 밝힌다", async () => {
    const seen: string[] = []
    const client = {
      searchOrdinance: async ({ query }: { query: string }) => {
        seen.push(query)
        return seen.length === 1 ? EMPTY : HIT
      },
    } as unknown as LawApiClient
    const r = await searchOrdinance(client, { query: "광진구 휴직 조례", display: 10 })
    expect(seen.length).toBeGreaterThan(1)
    expect(r.content[0].text).toMatch(/확장/)
  })
})
