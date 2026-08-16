import { describe, it, expect } from "vitest"
import { citeCheck } from "./cite-check.js"
import type { LawApiClient } from "../lib/api-client.js"

const TARGET_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<prec><판례일련번호>204201</판례일련번호><사건명><![CDATA[손해배상(기)]]></사건명>` +
  `<사건번호>2013다61381</사건번호><법원명>대법원</법원명><선고일자>20181030</선고일자>` +
  `<판결유형>전원합의체 판결</판결유형></prec></PrecSearch>`

const CITING_SEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>0</totalCnt><page>1</page></PrecSearch>`

const HOLDING = "[1] 일본 정부의 한반도에 대한 불법적인 식민지배 및 침략전쟁의 수행과 직결된 일본 기업의 " +
  "반인도적인 불법행위를 전제로 하는 강제동원 피해자의 일본 기업에 대한 위자료청구권이 청구권협정의 " +
  "적용대상에 포함되는지 여부(소극)"

const TARGET_DETAIL_JSON = JSON.stringify({
  PrecService: {
    사건번호: "2013다61381",
    사건명: "손해배상(기)",
    판시사항: HOLDING,
    판결요지: "판결요지 본문",
    참조판례: "",
    판례내용: "본문 전문 — 이 문장은 응답에 통째로 실리면 안 된다.",
  },
})

function stubClient(): LawApiClient {
  return {
    fetchApi: async (params: { endpoint: string; target: string; extraParams?: Record<string, string> }) => {
      if (params.endpoint === "lawService.do") return TARGET_DETAIL_JSON
      if (params.extraParams?.nb) return TARGET_SEARCH_XML
      return CITING_SEARCH_XML
    },
  } as unknown as LawApiClient
}

describe("citeCheck — 판시사항 노출 (#95)", () => {
  it("대상 판례의 판시사항을 응답에 포함한다", async () => {
    const r = await citeCheck(stubClient(), { caseNumber: "2013다61381", display: 20, deepScan: false })
    const text = r.content[0].text
    expect(text).toContain("판시사항")
    expect(text).toContain("강제동원")
  })

  it("판시사항만 발췌하고 전문(판례내용)은 붙이지 않는다", async () => {
    const r = await citeCheck(stubClient(), { caseNumber: "2013다61381", display: 20, deepScan: false })
    const text = r.content[0].text
    expect(text).not.toContain("본문 전문")
  })
})
