import { describe, expect, it } from "vitest"
import { getAnnexes } from "./annex.js"
import { ExecutionLimitError } from "../lib/execution-limits.js"
import { requestContext } from "../lib/session-state.js"
import type { LawApiClient } from "../lib/api-client.js"

// #150-1②: 4단 사다리가 "rung이 던졌다(장애)"와 "정상 응답인데 0건(부존재)"을
// 구분하지 않으면, 일시 장애의 전멸이 "법제처 DB에 없습니다"라는 부존재 단정으로
// 둔갑한다 — 실재하는 별표를 없다고 자문하는 거짓 부정이다.

const EMPTY_ENVELOPE = JSON.stringify({ licBylSearch: { totalCnt: 0 } })

describe("get_annexes 사다리 — 장애와 부존재의 구분 (#150)", () => {
  it("전 단이 장애로 비면 부존재 단정 대신 '존재 여부 확인 불가'로 낸다", async () => {
    const fetchApiTargets: string[] = []
    const client = {
      getAnnexes: async () => {
        throw new Error("별표·서식 검색 결과를 받지 못했습니다 - API가 HTML 에러 페이지를 반환했습니다.")
      },
      fetchApi: async (p: { target: string }) => {
        fetchApiTargets.push(p.target)
        throw new Error("admbyl도 실패")
      },
    } as unknown as LawApiClient

    const r = await getAnnexes(client, { lawName: "도로교통법" } as never)

    expect(r.isError).toBe(true)
    expect(fetchApiTargets).toContain("admbyl")   // 1단 장애 후에도 사다리는 계속 시도한다
    const text = r.content[0].text
    expect(text).toContain("[UPSTREAM_NO_DATA]")
    expect(text).toContain("존재 여부")
    expect(text).not.toContain("[NOT_FOUND]")
    expect(text).not.toContain("법제처 DB에 없습니다")
  })

  it("정상 응답 0건 전멸은 여전히 부존재로 안내한다 (회귀 고정)", async () => {
    const client = {
      getAnnexes: async () => EMPTY_ENVELOPE,
      fetchApi: async () => JSON.stringify({ admRulBylSearch: { totalCnt: 0 } }),
    } as unknown as LawApiClient

    const r = await getAnnexes(client, { lawName: "도로교통법" } as never)
    expect(r.content[0].text).toContain("법제처 DB에 없습니다")
  })

  it("ExecutionLimitError는 rung 4 catch가 삼키지 않고 즉시 전파한다", async () => {
    const client = {
      getAnnexes: async () => EMPTY_ENVELOPE,
      fetchApi: async () => { throw new ExecutionLimitError("upstream budget exhausted") },
    } as unknown as LawApiClient

    const r = await getAnnexes(client, { lawName: "도로교통법" } as never)
    expect(r.isError).toBe(true)
    const text = r.content[0].text
    expect(text).toContain("upstream budget exhausted")
    expect(text).not.toContain("법제처 DB에 없습니다")
    expect(text).not.toContain("존재 여부를 확인할 수 없습니다")   // 장애 요약이 아니라 즉시 전파
  })

  it("취소 신호가 선 뒤의 rung 실패는 삼키지 않고 전파한다 (rung 4 catch 포함)", async () => {
    const controller = new AbortController()
    controller.abort("client gone")
    const client = {
      getAnnexes: async () => EMPTY_ENVELOPE,
      fetchApi: async () => { throw new Error("cancelled upstream") },
    } as unknown as LawApiClient

    const r = await requestContext.run({ signal: controller.signal }, () =>
      getAnnexes(client, { lawName: "도로교통법" } as never))

    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("cancelled upstream")
    expect(r.content[0].text).not.toContain("법제처 DB에 없습니다")
  })
})
