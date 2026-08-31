import { beforeEach, describe, expect, it } from "vitest"
import { filterByArticleRelevance } from "./ordinance-relevance.js"
import { ExecutionLimitError } from "./execution-limits.js"
import { requestContext } from "./session-state.js"
import { lawCache } from "./cache.js"
import type { LawApiClient } from "./api-client.js"

// #150-6: fetchBody의 무조건 catch가 취소·예산 초과까지 "미확인"으로 삼키고,
// 실패 건도 checked("실제로 열어본 건수")에 계상됐다 — 표면의 "상위 N건 조회"가
// 실제로 열지 못한 건수를 포함해 과대 보고된다.

const items = [{ id: "901" }, { id: "902" }]
const target = { lawName: "도로교통법", jo: "제148조의2" }

describe("filterByArticleRelevance — 실패 건 취급 (#150)", () => {
  // 본문 캐시는 모듈 전역 — 테스트끼리 물려주면 "조회 실패"가 "캐시 히트"로 가려진다
  beforeEach(() => lawCache.clear())

  it("조회 실패 건은 checked에 계상하지 않고 미확인으로 남긴다", async () => {
    const client = {
      getOrdinance: async (id: string) => {
        if (id === "902") throw new Error("HTTP 500")
        return JSON.stringify({ 조문: "「도로교통법」 제148조의2에 따른다" })
      },
    } as unknown as LawApiClient

    const r = await filterByArticleRelevance(client, items, (x) => x.id, target)
    expect(r.confirmed.map((x) => x.id)).toEqual(["901"])
    expect(r.unconfirmed.map((x) => x.id)).toEqual(["902"])
    expect(r.checked).toBe(1)   // 실패한 902는 "열어본" 건수가 아니다
    expect(r.skipped).toBe(0)
  })

  it("ExecutionLimitError는 미확인으로 삼키지 않고 전파한다", async () => {
    const client = {
      getOrdinance: async () => { throw new ExecutionLimitError("upstream budget exhausted") },
    } as unknown as LawApiClient

    await expect(filterByArticleRelevance(client, items, (x) => x.id, target))
      .rejects.toThrow(ExecutionLimitError)
  })

  it("취소된 요청의 조회 실패도 전파한다", async () => {
    const controller = new AbortController()
    controller.abort("client gone")
    const client = {
      getOrdinance: async () => { throw new Error("socket closed") },
    } as unknown as LawApiClient

    await expect(requestContext.run({ signal: controller.signal }, () =>
      filterByArticleRelevance(client, items, (x) => x.id, target),
    )).rejects.toThrow("socket closed")
  })
})
