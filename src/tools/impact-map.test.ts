import { describe, it, expect, beforeEach } from "vitest"
import { impactMap } from "./impact-map.js"
import { parseBucket } from "../lib/impact-buckets.js"
import { parseArticleAnchor } from "../lib/article-anchor.js"
import { lawCache } from "../lib/cache.js"
import type { LawApiClient } from "../lib/api-client.js"

const UNRELATED_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>56</totalCnt>` +
  `<law id="1"><법령일련번호>3274</법령일련번호><법령명한글><![CDATA[1980년해직공무원의보상등에관한특별조치법]]></법령명한글><법령ID>001348</법령ID><법령구분명>법률</법령구분명></law>` +
  `</LawSearch>`

describe("impactMap — 무관 법령 가드", () => {
  beforeEach(() => lawCache.clear())

  it("검색 1위가 요청 법령과 무관하면 영향 지도를 그리지 않는다", async () => {
    // 가드가 조기 반환하지 않으면 병렬 하위검색이 이 스텁에 없는 메서드를 불러 터진다
    const client = {
      searchLaw: async () => UNRELATED_XML,
    } as unknown as LawApiClient

    const r = await impactMap(client, { lawName: "상법", jo: "제1조", includeOrdinances: true, includeMermaid: true })
    const text = r.content[0].text
    expect(r.isError).toBe(true)
    expect(text).toContain("[NOT_FOUND]")
    expect(text).not.toContain("Impact Map:")
  })
})

const CIVIL_LAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>` +
  `<law id="1"><법령일련번호>284415</법령일련번호><법령명한글><![CDATA[민법]]></법령명한글><법령ID>001706</법령ID><법령구분명>법률</법령구분명></law>` +
  `</LawSearch>`

// 헌재 결정례 2건: 제1032조(무관 조문) + 제103조(정답). #90의 실측 재현 데이터.
const DETC_XML = `<?xml version="1.0" encoding="UTF-8"?><DetcSearch><totalCnt>2</totalCnt><page>1</page>` +
  `<Detc><헌재결정례일련번호>190459</헌재결정례일련번호><사건명><![CDATA[민법 제1032조 위헌소원]]></사건명>` +
  `<사건번호>2024헌바107</사건번호><종국일자>20250130</종국일자></Detc>` +
  `<Detc><헌재결정례일련번호>53221</헌재결정례일련번호><사건명><![CDATA[민법 제103조 위헌소원]]></사건명>` +
  `<사건번호>2007헌바12</사건번호><종국일자>20080828</종국일자></Detc>` +
  // #116: 조번호는 같지만 법령이 다르다 — 제외돼야 한다
  `<Detc><헌재결정례일련번호>900001</헌재결정례일련번호><사건명><![CDATA[상법 제103조 위헌소원]]></사건명>` +
  `<사건번호>2010헌바99</사건번호><종국일자>20110101</종국일자></Detc>` +
  // #116: 법령명을 읽을 수 없다 — 보류로 유지돼야 한다
  `<Detc><헌재결정례일련번호>900002</헌재결정례일련번호><사건명><![CDATA[제103조 위헌소원]]></사건명>` +
  `<사건번호>2012헌바7</사건번호><종국일자>20130101</종국일자></Detc>` +
  `</DetcSearch>`

const PREC_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<prec><판례일련번호>245007</판례일련번호><사건명><![CDATA[민법 제103조에서 정한 반사회적 법률행위에 해당하여 무효]]></사건명>` +
  `<사건번호>2023다302036</사건번호><법원명>대법원</법원명><선고일자>20240208</선고일자><판결유형>판결</판결유형></prec>` +
  `</PrecSearch>`

const EMPTY_EXPC = `<?xml version="1.0" encoding="UTF-8"?><Expc><totalCnt>0</totalCnt><page>1</page></Expc>`
const EMPTY_DECC = `<?xml version="1.0" encoding="UTF-8"?><Decc><totalCnt>0</totalCnt><page>1</page></Decc>`
const ORDIN_XML = `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>1</totalCnt><page>1</page>` +
  `<law><자치법규일련번호>1279715</자치법규일련번호><자치법규명><![CDATA[동해시 시민법률상담 운영 조례]]></자치법규명>` +
  `<지자체기관명>동해시</지자체기관명><공포일자>20200101</공포일자><시행일자>20200101</시행일자></law>` +
  `</OrdinSearch>`

function articleJson(jo: string, title: string, body: string): string {
  return JSON.stringify({
    법령: {
      기본정보: { 법령명_한글: "민법" },
      조문: { 조문단위: { 조문여부: "조문", 조문번호: jo, 조문제목: title, 조문내용: body } },
    },
  })
}

function civilLawClient(): LawApiClient {
  return {
    searchLaw: async () => CIVIL_LAW_XML,
    searchOrdinance: async () => ORDIN_XML,
    fetchApi: async (params: { endpoint: string; target: string }) => {
      switch (params.target) {
        case "eflaw": return articleJson("103", "반사회질서의 법률행위", "제103조(반사회질서의 법률행위) 선량한 풍속…")
        case "detc": return DETC_XML
        case "prec": return PREC_XML
        case "expc": return EMPTY_EXPC
        case "decc": return EMPTY_DECC
        default: return ""
      }
    },
  } as unknown as LawApiClient
}

describe("impactMap — 조번호 경계 앵커 (#90)", () => {
  beforeEach(() => lawCache.clear())

  it("정방향: 제103조 질의에 제1032조 자료가 섞이지 않는다 (헌재 경로 포함)", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "제103조", includeOrdinances: true, includeMermaid: false,
    })
    const text = r.content[0].text
    expect(text).toContain("[53221]")        // 제103조 위헌소원 — 유지
    expect(text).not.toContain("[190459]")   // 제1032조 위헌소원 — 제외
    expect(text).not.toContain("제1032조")
  })

  it("정방향: 조문 표기가 없는 판례·조례 항목은 죽이지 않는다", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "제103조", includeOrdinances: true, includeMermaid: false,
    })
    const text = r.content[0].text
    expect(text).toContain("[245007]")   // 민법 제103조 명시 판례
    expect(text).toContain("[1279715]")  // 조번호 표기 없는 조례 — 판정 보류로 유지
  })

  it("역방향: 제1032조 질의에 제103조 자료가 섞이지 않는다 (R05)", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "제1032조", includeOrdinances: true, includeMermaid: false,
    })
    const text = r.content[0].text
    expect(text).toContain("[190459]")       // 제1032조 위헌소원 — 유지
    expect(text).not.toContain("[53221]")    // 제103조 위헌소원 — 제외
    expect(text).not.toContain("[245007]")   // 제103조 명시 판례 — 제외
  })

  it("경계 앵커로 제외된 건이 있으면 응답에 명시한다", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "제103조", includeOrdinances: true, includeMermaid: false,
    })
    expect(r.content[0].text).toMatch(/조문 불일치|경계 불일치/)
  })
})

describe("impactMap — 법령명 축 (#116)", () => {
  beforeEach(() => lawCache.clear())

  it("조번호가 같아도 법령이 다르면 제외한다", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "제103조", includeOrdinances: true, includeMermaid: false,
    })
    expect(r.content[0].text).not.toContain("[900001]")  // 상법 제103조
  })

  it("법령명을 읽을 수 없는 항목은 제외가 아니라 보류로 유지한다", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "제103조", includeOrdinances: true, includeMermaid: false,
    })
    expect(r.content[0].text).toContain("[900002]")
  })

  it("법령명 대조 결과를 확정/보류로 밝힌다", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "제103조", includeOrdinances: true, includeMermaid: false,
    })
    expect(r.content[0].text).toMatch(/법령명 대조:\s*확정 \d+건\s*\/\s*보류 \d+건/)
  })
})

describe("parseBucket — 항목 경계", () => {
  // 렌더러는 항목마다 빈 줄로 끊고 마지막에 안내문을 붙인다. 안내문에 질의 조번호가
  // 들어있는데("검색 보정: …민법 제103조") 그게 마지막 항목에 붙으면, 무관 조문
  // 항목이 되살아나 오탐이 그대로 통과한다.
  it("항목 뒤 안내문의 조번호가 항목 판정에 스며들지 않는다", () => {
    const text = [
      "판례 검색 결과 (총 1건, 1페이지):",
      "",
      "[9] 민법 제1032조 관련 사건",
      "  사건번호: 2024헌바107",
      "",
      `검색 보정: body_search="민법 제103조" (전체)`,
      `💡 다음: get_precedent_text(id="9")`,
      "",
    ].join("\n")
    const stat = parseBucket({ text, isError: false }, parseArticleAnchor("제103조")!, 5)
    expect(stat.topItems).toEqual([])
    expect(stat.excluded).toBe(1)
  })
})

describe("impactMap — jo 파라미터 계약 (#98)", () => {
  beforeEach(() => lawCache.clear())

  it("6자리 JO 코드를 get_law_text와 동일하게 수용한다", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "010300", includeOrdinances: true, includeMermaid: false,
    })
    const text = r.content[0].text
    expect(r.isError).toBeFalsy()
    expect(text).toContain("민법 제103조")
    expect(text).not.toContain("제010300")
    expect(text).toContain("[53221]")
  })

  it("해석 불가 입력은 조용한 0건이 아니라 명시적 에러", async () => {
    const r = await impactMap(civilLawClient(), {
      lawName: "민법", jo: "어딘가", includeOrdinances: true, includeMermaid: false,
    })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/\[INVALID_ARGUMENT\]|조문 번호/)
  })
})
