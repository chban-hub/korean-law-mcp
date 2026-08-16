import { describe, it, expect, vi, afterEach } from "vitest"
import { LawApiClient } from "../lib/api-client.js"
import { getThreeTier } from "./three-tier.js"
import { getLawSystemTree } from "./law-system-tree.js"

// 단건 조회 미스가 도구 표면에 도달하는 방식.
// 두 도구 모두 `lawService.do` 미스를 200 + 빈 본문/권한 안내 HTML로 받는다(이슈 #88).
// get_law_system_tree는 XML→JSON 2연속 호출이라, XML 분기만 고치면 JSON 미스가
// 두 번째 사다리를 여는 함정이 있다 — 여기서 그 함정을 못 박는다.

const LSSTMD_NOTICE_HTML =
  `<!DOCTYPE html><html><body>국가법령정보 공동활용 미신청된 목록/본문에 대한 접근입니다.</body></html>`

describe("get_law_system_tree — 미스", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("XML 미스가 두 번째(JSON) 사다리를 열지 않고, 총 업스트림 2회로 끝난다", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url))
      return String(url).includes("type=XML")
        ? new Response(LSSTMD_NOTICE_HTML, { status: 200, headers: { "content-type": "text/html" } })
        : new Response("", { status: 200, headers: { "content-type": "application/json" } })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const result = await getLawSystemTree(client, { mst: "99999999" })

    expect(result.isError).toBe(true)
    expect(urls.length).toBe(2)
    expect(urls.every((u) => u.includes("type=XML"))).toBe(true)
  }, 30000)
})

describe("get_three_tier — 미스", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("빈 본문 미스를 파서 예외가 아니라 NOT_FOUND로 표면화한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("", { status: 200, headers: { "content-type": "application/json" } })))

    const client = new LawApiClient({ apiKey: "test" })
    const result = await getThreeTier(client, { mst: "99999999", knd: "2" })

    expect(result.isError).toBe(true)
    // 기존: "[EXTERNAL_API_ERROR] Unexpected end of JSON input" — 원인이 파서로 보였다
    expect(result.content[0].text).toContain("LAW_NOT_FOUND")
    expect(result.content[0].text).not.toContain("Unexpected end of JSON input")
  }, 30000)
})
