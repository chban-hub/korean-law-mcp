/**
 * 체인 데드라인 통합 — 실제 체인이 부분 결과를 조립하는가 (#131)
 *
 * 업스트림은 전부 mock 이다. 느린 응답은 setTimeout 으로 흉내내고, 데드라인은
 * 환경변수로 짧게 줄여 실제 대기 없이 발동시킨다.
 */
import { describe, it, expect, afterEach } from "vitest"
import { chainActionBasis, chainFullResearch, chainDisputePrep } from "./chains.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const lawXml = (name: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt><law id="1">` +
  `<법령일련번호>9001</법령일련번호><법령명한글><![CDATA[${name}]]></법령명한글>` +
  `<법령ID>1001</법령ID><법령구분명>법률</법령구분명></law></LawSearch>`

const empty = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>0</totalCnt></LawSearch>`

/** 어떤 파서가 읽어도 0건이 되는 무근(root 불일치) 응답 */
const emptyAny = `<?xml version="1.0" encoding="UTF-8"?><Empty><totalCnt>0</totalCnt></Empty>`

const interpXml =
  `<?xml version="1.0" encoding="UTF-8"?><Expc><totalCnt>1</totalCnt><expc id="1">` +
  `<법령해석례일련번호>8001</법령해석례일련번호><안건명>테스트 안건</안건명>` +
  `<안건번호>24-0001</안건번호><회신일자>20240101</회신일자><회신기관명>법제처</회신기관명></expc></Expc>`

const appealXml =
  `<?xml version="1.0" encoding="UTF-8"?><Decc><totalCnt>1</totalCnt><decc id="1">` +
  `<행정심판재결례일련번호>7001</행정심판재결례일련번호><사건명>취소 재결 사건</사건명>` +
  `<사건번호>2024-001</사건번호><의결일자>20240301</의결일자><재결청>중앙행정심판위원회</재결청></decc></Decc>`

const after = <T,>(ms: number, value: T): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms))

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

  it("full_research도 데드라인 env 오류를 형식화해 반환한다 (생 throw 금지, #150)", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "abc"
    lawCache.clear()
    const res = await chainFullResearch(stallingClient(), { query: "민법 손해" })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text ?? "").toContain("MCP_CHAIN_DEADLINE_MS")
  }, 20_000)
})

describe("#150 데드라인이 체인 프리픽스(기반 탐색)까지 묶는다", () => {
  it("action_basis: 기반 법령 검색이 매달려도 시간 한도 안에 부분 반환한다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    lawCache.clear()
    // 법령 검색부터 응답하지 않는 업스트림 — 종전에는 데드라인이 이 구간 밖이라 무한 대기였다
    const client = {
      async searchLaw() { return new Promise<string>(() => {}) },
      async fetchApi() { return new Promise<string>(() => {}) },
    } as unknown as LawApiClient

    const started = Date.now()
    const res = await chainActionBasis(client, { query: "여권 재발급 기한" })
    const text = res.content[0]?.text ?? ""

    expect(Date.now() - started).toBeLessThan(15_000)
    expect(text).toContain("처분 근거 확인")
    expect(text).toContain("시간 한도")
    // 만료를 "검색 결과 없음"으로 둔갑시키지 않는다
    expect(text).not.toContain("[NOT_FOUND]")
    expect(res.isError).toBeFalsy()
  }, 20_000)

  it("full_research: 프리픽스가 늦게 끝나도 요청 안 한 갈래에 가짜 타임아웃 마커를 달지 않는다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    lawCache.clear()
    // AI 검색만 데드라인(5초) 너머(6.5초)에 응답 — 별표·시나리오는 요청 자체가 없는 질의다
    const client = {
      async searchLaw() { return lawXml("도로교통법") },
      async getLawText() { throw new Error("본문 조회 생략(mock)") },
      async fetchApi({ target }: { target?: string }) {
        if (target === "aiSearch") return after(6_500, emptyAny)
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await chainFullResearch(client, { query: "도로교통법 원동기 규정" })
    const text = res.content[0]?.text ?? ""

    expect(text).toContain("종합 리서치")
    expect(text).toContain("시간 한도")
    // 요청하지 않은 섹션(별표 없음·시나리오 null)에 "시간 한도로 수집 실패" 마커 금지
    expect(text).not.toMatch(/▶ 별표\/서식\n⏱/)
    expect(text).not.toContain("시나리오(null)")
    expect(res.isError).toBeFalsy()
  }, 20_000)

  it("dispute_prep: 판례 검색이 매달려도 행정심판 수신분은 싣고 마커로 부분 반환한다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    lawCache.clear()
    const client = {
      async fetchApi({ endpoint, target }: { endpoint?: string; target?: string }) {
        if (target === "prec") return new Promise<string>(() => {})      // 판례 검색 매달림
        if (endpoint === "lawService.do") return new Promise<string>(() => {}) // 상세조회 매달림
        if (target === "decc") return appealXml                           // 행심 검색은 즉시
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await chainDisputePrep(client, { query: "건축허가 취소 재결" })
    const text = res.content[0]?.text ?? ""

    expect(text).toContain("쟁송 대비")
    expect(text).toMatch(/▶ 대법원 판례\n⏱/)      // 매달린 갈래는 마커
    expect(text).toContain("[7001]")               // 받은 행심 검색은 그대로 싣는다
    expect(text).toMatch(/▶ 행정심판례 상세\n⏱/)  // 상세 단계만 만료 마커
    expect(res.isError).toBeFalsy()
  }, 20_000)
})

describe("#150 action_basis 근거 갈래는 단계별로 나눠 수신분을 보존한다", () => {
  it("상세조회가 매달려도 받은 검색 3종은 폐기하지 않는다", async () => {
    process.env.MCP_CHAIN_DEADLINE_MS = "5000"
    lawCache.clear()
    const client = {
      async searchLaw() { return lawXml("도로교통법") },
      async getThreeTier() { return new Promise<string>(() => {}) },
      async fetchApi({ endpoint, target }: { endpoint?: string; target?: string }) {
        if (endpoint === "lawService.do") return new Promise<string>(() => {}) // 상세조회만 매달림
        if (target === "expc") return interpXml
        return emptyAny
      },
    } as unknown as LawApiClient

    const res = await chainActionBasis(client, { query: "도로교통법 원동기 규정" })
    const text = res.content[0]?.text ?? ""

    expect(text).toContain("[8001]")                       // 해석례 검색 수신분이 실린다
    expect(text).toMatch(/▶ 법령 해석례 상세\n⏱/)          // 미완 상세만 마커
    expect(text).not.toContain("법령 해석례·판례·행정심판례") // 갈래 통짜 마커로 뭉뚱그리지 않는다
    // 요청 안 한 별표·시나리오에 가짜 마커 금지
    expect(text).not.toMatch(/▶ 별표 \(과태료\/기준표\)\n⏱/)
    expect(text).not.toContain("시나리오(null)")
    expect(res.isError).toBeFalsy()
  }, 20_000)
})
