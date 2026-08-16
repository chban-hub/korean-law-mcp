import { describe, it, expect, vi, afterEach } from "vitest"
import { LawApiClient } from "./api-client.js"

// 법제처 DRF는 미스도 HTTP 200으로 답한다. `lawService.do` 단건 조회의 일부 조합은
// 그 200에 **빈 본문**(prec·thdCmp·lsStmd + JSON) 또는 **권한 안내 HTML**(lsStmd + XML)을
// 실어 보내는데, 이것이 "점검·과부하" 신호로 오인돼 재시도 사다리를 완주했다.
// 실측(2026-08-16, 이슈 #88 정정 코멘트): get_three_tier 미스 12.9초 / 업스트림 4회,
// get_law_system_tree 미스 10.6초 / 4회. 반면 검색(`lawSearch.do`) 미스는 18/18이
// 정상 봉투라 같은 위험이 없다 — 그쪽 방어는 건드리지 않는다.

// lsStmd/XML 미스 실본문(요지). 문구는 OC 키의 API 신청 상태에 따라 달라지므로
// 분류가 이 문안에 의존해서는 안 된다.
const LSSTMD_NOTICE_HTML =
  `<!DOCTYPE html><html><head><title>국가법령정보 공동활용</title></head><body>` +
  `국가법령정보 공동활용 미신청된 목록/본문에 대한 접근입니다. OPEN API 로그인 후 신청하세요.` +
  `</body></html>`

const emptyJson = () => new Response("", { status: 200, headers: { "content-type": "application/json" } })

describe("lawService.do 단건 조회 미스 — 확인 1회 후 표면화", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("thdCmp 빈 본문 미스: 업스트림 2회로 끊고 오류로 표면화한다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return emptyJson() }))

    const client = new LawApiClient({ apiKey: "test" })
    const started = Date.now()
    await expect(client.getThreeTier({ mst: "99999999" })).rejects.toThrow()

    expect(n).toBe(2)                              // 최초 + 확인 재시도 1회
    expect(Date.now() - started).toBeLessThan(1000) // 사다리(1+2+4s) 소진 아님
  }, 30000)

  it("일시 장애로 한 번 비었다가 회복되면 정상 응답을 돌려준다 (미스 오탐 방지)", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return n === 1 ? emptyJson() : new Response(`{"법령": {"기본정보": {}}}`, { status: 200 })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    await expect(client.getThreeTier({ mst: "288689" })).resolves.toContain("기본정보")
    expect(n).toBe(2)
  }, 30000)

  it("lsStmd 권한 안내 HTML 미스: 문구 매칭 없이 2회로 끊는다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++
      return new Response(LSSTMD_NOTICE_HTML, { status: 200, headers: { "content-type": "text/html" } })
    }))

    const client = new LawApiClient({ apiKey: "test" })
    await expect(client.fetchApi({
      endpoint: "lawService.do",
      target: "lsStmd",
      type: "XML",
      extraParams: { MST: "99999999" },
    })).rejects.toThrow()
    expect(n).toBe(2)
  }, 30000)

  it("검색(lawSearch.do)의 빈 본문은 여전히 일시 장애로 보고 사다리를 유지한다", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return emptyJson() }))

    const client = new LawApiClient({ apiKey: "test" })
    await expect(client.searchLaw("민법")).rejects.toThrow()
    expect(n).toBe(4)                              // 1회 + 재시도 3회 = 기존 방어 그대로
  }, 30000)
})

describe("백오프 상수 — 업스트림 왕복 대비 비율", () => {
  afterEach(() => vi.unstubAllGlobals())

  // 업스트림 왕복은 검색 ~0.45초 / 단건 조회 ~0.9초(04_qa_verification.md §2.1·§3.2)인데
  // base 1,000ms 사다리는 1+2+4초(지터 최대 +50%)를 태워 왕복의 6~8배를 대기에 썼다.
  it("404 사다리 소진이 5초 안에 끝난다 (재시도 횟수·retryOn은 그대로)", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => { n++; return new Response("Not Found", { status: 404 }) }))

    const client = new LawApiClient({ apiKey: "test" })
    const started = Date.now()
    await expect(client.fetchApi({
      endpoint: "lawSearch.do",
      target: "lsHistory",
      type: "HTML",
      extraParams: { query: "소득세법" },
    })).rejects.toThrow(/404/)

    expect(n).toBe(4)                               // 버스트 404 워크어라운드 유지
    expect(Date.now() - started).toBeLessThan(5000)
  }, 30000)
})
