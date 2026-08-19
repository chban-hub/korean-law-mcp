import { describe, it, expect, vi, afterEach } from "vitest"
import { LawApiClient } from "./api-client.js"

// 회귀 (2026-08-19 형사소송법 실측): lawService.do target=eflaw 단건 조회는 MST 단독
// (efYd 미동반)으로 "현행이 아닌" 버전을 못 푼다 — 시행 예정판(MST 288579, 시행
// 2026.10.2.)과 과거 연혁판(MST 280441, 시행 2026.6.24.) 모두 200 + "{}"로 온다.
// 같은 MST를 target=law로 치면 그 버전 전문(부칙 포함)이 그대로 회수되므로
// getLawText는 빈 봉투일 때 law 타깃으로 1회 폴백해야 한다. 이 갭은 2026.10.2.
// 형소법 대개정(§215조의2 검사 직권 삭제 등)을 도구가 통째로 침묵하게 만든
// 서면 사고 경로였다.

const LAW_BODY = `{"법령": {"기본정보": {"법령명_한글": "형사소송법", "시행일자": 20261002}}}`

const jsonRes = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" } })

describe("getLawText — eflaw 빈 봉투 시 law 타깃 폴백", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("eflaw가 '{}'를 주면 target=law로 폴백해 그 MST 버전을 회수한다", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url))
      return String(url).includes("target=eflaw") ? jsonRes("{}") : jsonRes(LAW_BODY)
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ mst: "288579" })

    expect(text).toContain("기본정보")
    expect(urls).toHaveLength(2)
    expect(urls[0]).toContain("target=eflaw")
    expect(urls[1]).toContain("target=law")
    expect(urls[1]).toContain("MST=288579")
  })

  it("폴백 요청에 JO 파라미터를 유지한다 (조문 단건 조회 경로)", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url))
      return String(url).includes("target=eflaw") ? jsonRes("{}") : jsonRes(LAW_BODY)
    }))

    const client = new LawApiClient({ apiKey: "test" })
    await client.getLawText({ mst: "288579", jo: "021502" })

    expect(urls[1]).toContain("target=law")
    expect(urls[1]).toContain("JO=021502")
  })

  it("eflaw가 정상 법령 노드를 주면 폴백하지 않는다", async () => {
    let calls = 0
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; return jsonRes(LAW_BODY) }))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ mst: "281865" })

    expect(text).toContain("기본정보")
    expect(calls).toBe(1)
  })

  it("MST 없는 조회(lawId)는 빈 봉투라도 폴백하지 않는다 (발동 조건 보수 유지)", async () => {
    let calls = 0
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; return jsonRes("{}") }))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ lawId: "1234" })

    expect(text).toBe("{}")   // 상위 레이어(law-text.ts)가 NOT_FOUND로 표면화
    expect(calls).toBe(1)
  })

  it("law 폴백도 빈 봉투면 원래 eflaw 응답을 그대로 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes("{}")))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ mst: "99999999" })

    expect(text).toBe("{}")   // NOT_FOUND 표면화는 상위 레이어 몫 — 여기서 추측 금지
  })
})

// 회귀: MST는 "공포본" 단위라 분리시행 공포본이면 target=law가 시점과 무관하게
// 마지막 시행 슬라이스를 돌려준다 (실측 2026-08-19: target=law&MST=281865 →
// 시행일자 20271231. 2026.7.1.에 시행 중인 슬라이스가 아니다).
// 따라서 시행일을 못박은 호출(efYd 동반)에는 폴백이 붙으면 안 된다 — 붙으면
// applicable_law의 행위시법 조문 비교가 다른 슬라이스 본문으로 조용히 오염된다.
describe("getLawText — efYd 지정 요청은 폴백 대상이 아니다", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("efYd가 있으면 빈 봉투라도 law로 폴백하지 않는다", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url))
      return jsonRes("{}")
    }))

    const client = new LawApiClient({ apiKey: "test" })
    const text = await client.getLawText({ mst: "281865", efYd: "20260701" })

    expect(text).toBe("{}")
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("target=eflaw")
    expect(urls.some(u => u.includes("target=law&"))).toBe(false)
  })
})
