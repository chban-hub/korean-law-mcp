import { describe, it, expect, vi, afterEach } from "vitest"
import { LawApiClient } from "../lib/api-client.js"
import { getPrecedentText } from "./precedents.js"

// 판례 미스 경로(#112). 두 종류의 "없음"이 섞여 있고, 취급이 달라야 한다.
//  (a) 200 + 0바이트  — 확인 재시도까지 마친 미스. HTML 폴백을 더 돌아도 같은 답이다.
//  (b) 200 + 88바이트 `{"Law":"일치하는 판례가 없습니다…"}` — 국세법령정보 판례가 오는
//      모양이다(실측 ID 615819). 여기서는 폴백이 실제로 본문을 복구하므로 반드시 돌아야 한다.
const NTS_ENVELOPE = `{"Law": "일치하는 판례가 없습니다. 판례명을 확인하여 주십시오."}`
const HTML_WITHOUT_PRECEDENT = `<!DOCTYPE html><html><body><input id="precSeq" value="999"/></body></html>`

const emptyJson = () => new Response("", { status: 200, headers: { "content-type": "application/json" } })

describe("get_precedent_text — 확정된 미스", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("0바이트 미스는 HTML 폴백을 건너뛰고 업스트림 2회로 끝난다", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(String(url)); return emptyJson() }))

    const client = new LawApiClient({ apiKey: "test" })
    const result = await getPrecedentText(client, { id: "000000" } as any)

    expect(result.isError).toBe(true)
    expect(urls.length).toBe(2)                              // 폴백 왕복(type=HTML) 없음
    expect(urls.some((u) => u.includes("type=HTML"))).toBe(false)
  }, 30000)

  it("미스를 서버 오류가 아닌 UPSTREAM_NO_DATA로 표면화하고 부존재를 단정하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => emptyJson()))

    const client = new LawApiClient({ apiKey: "test" })
    const text = (await getPrecedentText(client, { id: "000000" } as any)).content[0].text

    expect(text).toContain("[UPSTREAM_NO_DATA]")
    expect(text).not.toContain("Precedent not found or invalid response format")
    expect(text).not.toContain("존재하지 않습니다")
    // 두 방향 금지가 나란히 서 있어야 한다: 지어내기 금지 + 부존재 단정 금지
    expect(text).toContain("부존재를 증명하지 않습니다")
    expect(text).toContain("추측하거나 지어내지 마세요")
  }, 30000)
})

describe("get_precedent_text — 국세법령정보 폴백 (회귀 금지)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("'일치하는 판례가 없습니다' 봉투에는 여전히 HTML 폴백을 시도한다", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url))
      return String(url).includes("type=HTML")
        ? new Response(HTML_WITHOUT_PRECEDENT, { status: 200, headers: { "content-type": "text/html" } })
        : new Response(NTS_ENVELOPE, { status: 200, headers: { "content-type": "application/json" } })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const result = await getPrecedentText(client, { id: "615819" } as any)

    expect(urls.some((u) => u.includes("type=HTML"))).toBe(true)   // 폴백 경로 살아 있음
    expect(result.isError).toBe(true)                              // 이 목업 페이지엔 그 판례가 없다
  }, 30000)

  it("두 원천이 모두 없다고 답하면 NOT_FOUND로 표면화한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("type=HTML")
        ? new Response(HTML_WITHOUT_PRECEDENT, { status: 200, headers: { "content-type": "text/html" } })
        : new Response(NTS_ENVELOPE, { status: 200, headers: { "content-type": "application/json" } })))

    const client = new LawApiClient({ apiKey: "test" })
    const text = (await getPrecedentText(client, { id: "615819" } as any)).content[0].text

    expect(text).toContain("[NOT_FOUND]")
    expect(text).not.toContain("invalid response format")
  }, 30000)
})
