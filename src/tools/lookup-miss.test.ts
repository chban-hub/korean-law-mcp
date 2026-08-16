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

  it("XML·JSON 어느 쪽도 재시도 사다리를 태우지 않는다 (호출당 확인 1회)", async () => {
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
    // 두 조회는 병렬이라 둘 다 발사된다. 중요한 건 각각이 사다리(4회)를 안 태우는 것.
    expect(urls.filter((u) => u.includes("type=XML")).length).toBe(2)
    expect(urls.filter((u) => u.includes("type=JSON")).length).toBe(2)
  }, 30000)

  it("히트 경로의 XML·JSON 조회가 직렬이 아니라 동시에 나간다", async () => {
    const delay = 300
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, delay))
      return String(url).includes("type=XML")
        ? new Response(`<?xml version="1.0"?><법령체계도><행정규칙></행정규칙></법령체계도>`, { status: 200 })
        : new Response(JSON.stringify({ 법령체계도: { 기본정보: { 법령명: "민법" }, 상하위법: {} } }), { status: 200 })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const started = Date.now()
    const result = await getLawSystemTree(client, { mst: "284415" })
    const elapsed = Date.now() - started

    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain("=== 법령체계도 ===")   // 출력 형식 무변경
    expect(elapsed).toBeLessThan(delay * 5 / 3)                      // 직렬이면 600ms 이상, 병렬이면 ~300ms
  }, 30000)
})

describe("get_three_tier — 미스", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("빈 본문 미스를 파서 예외가 아니라 UPSTREAM_NO_DATA로 표면화한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("", { status: 200, headers: { "content-type": "application/json" } })))

    const client = new LawApiClient({ apiKey: "test" })
    const result = await getThreeTier(client, { mst: "99999999", knd: "2" })

    expect(result.isError).toBe(true)
    // 기존: "[EXTERNAL_API_ERROR] Unexpected end of JSON input" — 원인이 파서로 보였다.
    // 라벨은 NOT_FOUND 계열과 분리한다 — 기계 독자에겐 라벨이 산문의 유보를 이긴다.
    expect(result.content[0].text).toContain("[UPSTREAM_NO_DATA]")
    expect(result.content[0].text).not.toContain("LAW_NOT_FOUND")
    expect(result.content[0].text).not.toContain("Unexpected end of JSON input")
  }, 30000)
})
