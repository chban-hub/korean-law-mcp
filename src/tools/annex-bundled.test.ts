import { describe, expect, it, vi, afterEach } from "vitest"

// 묶음 섹션 분기는 파일 파싱 성공 뒤에 돈다. 실제 HWP/PDF 픽스처 대신 파서를 갈아 끼운다.
const parsedMarkdown = { current: "" }
vi.mock("kordoc", () => ({
  parse: async () => ({ success: true, fileType: "hwpx", markdown: parsedMarkdown.current }),
}))

import { extractBundledSection, isBranchNumber, isBundledAnnex, listBundledSections } from "./annex-select.js"
import { getAnnexes } from "./annex.js"
import type { LawApiClient } from "../lib/api-client.js"

// 묶음 문서는 옆 번호를 실제로 담고 있다 — `parseInt("17의12")=17` 이라
// 가지번호를 물었는데 별표 17 섹션이 조용히 돌아왔다. 오답이 정답처럼 보이는 자리다.
const BUNDLE = [
  "## [별표 17] 과태료의 부과기준",
  "가나다 17 본문",
  "## [별표 17의12] 과징금의 산정기준",
  "라마바 17의12 본문",
  "## [별표 18] 수수료",
  "사아자 18 본문",
].join("\n")

describe("extractBundledSection — 가지번호 (부록 1)", () => {
  it("가지번호 섹션을 정확히 집는다", () => {
    const out = extractBundledSection(BUNDLE, "17의12")
    expect(out).toContain("과징금의 산정기준")
    expect(out).not.toContain("과태료의 부과기준")
    expect(out).not.toContain("수수료")
  })

  it("본번호는 가지번호 섹션을 삼키지 않는다", () => {
    const out = extractBundledSection(BUNDLE, "17")
    expect(out).toContain("과태료의 부과기준")
    expect(out).not.toContain("과징금의 산정기준")
  })

  it("없는 가지번호는 옆 번호를 대신 주지 않는다", () => {
    expect(extractBundledSection(BUNDLE, "17의99")).toBeNull()
  })

  it("섹션 표제 목록을 읽는다", () => {
    expect(listBundledSections(BUNDLE)).toEqual(["17", "17의12", "18"])
  })

  it("isBranchNumber 는 가지번호만 참", () => {
    expect(isBranchNumber("17의12")).toBe(true)
    expect(isBranchNumber("17")).toBe(false)
  })

  it("isBundledAnnex 는 별표 범위 표기만 (음성 결과 고정)", () => {
    expect(isBundledAnnex("[별표1~5] 과태료 부과기준")).toBe(true)
    expect(isBundledAnnex("[별표4] 대지안의 공지기준")).toBe(false)
  })
})

// ─── 도구 표면: 못 찾으면 조용한 폴백 대신 명시 실패 ───

const LIST_JSON = JSON.stringify({
  licBylSearch: {
    totalCnt: "1",
    licbyl: [{
      별표번호: "001712",
      별표명: "[별표 17~18] 과태료·과징금 기준",
      별표종류: "별표",
      별표서식파일링크: "/flDownload.do?flSeq=1",
      관련법령일련번호: "999999",
    }],
  },
})

function stubClient(): LawApiClient {
  return {
    getAnnexes: vi.fn(async () => LIST_JSON),
    fetchApi: vi.fn(async () => { throw new Error("no canonical") }),
  } as unknown as LawApiClient
}

describe("get_annexes — 묶음에서 가지번호를 못 찾을 때 (부록 1)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("옆 번호를 조용히 주지 않고 NOT_FOUND 로 표면화한다", async () => {
    // 파일 본문에는 17·18 만 있고 요청한 17의12 는 없다
    parsedMarkdown.current = "## [별표 17] 과태료의 부과기준\n본문\n## [별표 18] 수수료\n본문"
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })))

    const result = await getAnnexes(stubClient(), { lawName: "테스트법", bylSeq: "001712" })
    const text = result.content[0].text

    expect(result.isError).toBe(true)
    expect(text).toContain("[NOT_FOUND]")
    expect(text).toContain("17의12")
    expect(text).not.toContain("과태료의 부과기준")   // 옆 번호 본문이 새어 나오지 않는다
    expect(text).toContain("이 문서가 담은 섹션")     // 무엇이 있는지는 알려 준다
  }, 30000)

  it("가지번호 섹션이 있으면 그 섹션만 준다", async () => {
    parsedMarkdown.current = BUNDLE
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })))

    const result = await getAnnexes(stubClient(), { lawName: "테스트법", bylSeq: "001712" })
    const text = result.content[0].text

    expect(result.isError).toBeUndefined()
    expect(text).toContain("과징금의 산정기준")
    expect(text).not.toContain("가나다 17 본문")
  }, 30000)
})
