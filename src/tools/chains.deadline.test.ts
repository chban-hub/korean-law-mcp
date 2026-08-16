/**
 * 체인 데드라인 통합 — 실제 체인이 부분 결과를 조립하는가 (#131)
 *
 * 업스트림은 전부 mock 이다. 느린 응답은 setTimeout 으로 흉내내고, 데드라인은
 * 환경변수로 짧게 줄여 실제 대기 없이 발동시킨다.
 */
import { describe, it, expect, afterEach } from "vitest"
import { chainActionBasis } from "./chains.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const lawXml = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt><law id="1">` +
  `<법령일련번호>9001</법령일련번호><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>1001</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`

const empty = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>0</totalCnt></LawSearch>`

/** 법령 검색만 즉시 답하고 나머지 조회는 영원히 매달리는 업스트림 */
function stallingClient(): LawApiClient {
  return {
    async searchLaw() { return lawXml("도로교통법") },
    async fetchApi({ target }: { target?: string }) {
      if (target === "law" || target === "lawSearch") return lawXml("도로교통법")
      // 나머지(3단비교·판례·해석례·별표…)는 응답하지 않는다
      return new Promise<string>(() => {})
    },
  } as unknown as LawApiClient
}

const ORIGINAL = process.env.MCP_CHAIN_DEADLINE_MS
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MCP_CHAIN_DEADLINE_MS
  else process.env.MCP_CHAIN_DEADLINE_MS = ORIGINAL
  lawCache.clear()
})

describe("#131 데드라인 발동 시 부분 결과", () => {
  it("응답하지 않는 갈래를 침묵으로 버리지 않고 마커로 남긴다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    lawCache.clear()
    const res = await chainActionBasis(stallingClient(), { query: "음주운전 과태료 기준 얼마" })
    const text = res.content[0]?.text ?? ""

    // 기반 법령은 잡혔으므로 머리글은 나온다
    expect(text).toContain("처분 근거 확인")
    // 못 받은 섹션은 침묵이 아니라 마커 + 대체 조회 안내
    expect(text).toContain("시간 한도로 이 섹션은 수집하지 못했습니다")
    expect(text).toContain("get_three_tier")
    // 부분 결과는 유효한 답이다 — 오류로 표시하지 않는다
    expect(res.isError).toBeFalsy()
  }, 20_000)

  it("데드라인 값이 잘못되면 조용히 넘어가지 않는다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "abc"
    lawCache.clear()
    const res = await chainActionBasis(stallingClient(), { query: "음주운전 과태료 기준 얼마" })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text ?? "").toContain("MCP_CHAIN_DEADLINE_MS")
  }, 20_000)
})
