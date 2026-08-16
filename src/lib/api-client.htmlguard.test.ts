import { afterEach, describe, expect, it, vi } from "vitest"
import { LawApiClient } from "./api-client.js"

// HTML 판정이 세 벌로 갈려 있었다(#141). 재시도 계층은 앵커+대소문자 무시,
// api-client 는 비앵커+대소문자 구분 — 같은 본문에 두 계층이 다른 답을 냈다.
describe("checkHtmlError — 술어 단일화 (#141)", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("정상 XML 안에 <html 조각이 섞였다고 '점검 페이지'로 몰지 않는다", async () => {
    // 법령 본문은 CDATA 안에 서식 조각을 실어 나를 수 있다. 비앵커 includes 는
    // 이것을 HTML 에러 페이지로 오인해 정상 검색 결과를 통째로 버렸다.
    const xml = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt>` +
      `<law id="1"><법령명한글><![CDATA[별지 서식 <html>표</html> 관련 법률]]></법령명한글></law></LawSearch>`
    vi.stubGlobal("fetch", vi.fn(async () => new Response(xml, { status: 200 })))

    await expect(new LawApiClient({ apiKey: "test" }).searchLaw("민법")).resolves.toContain("totalCnt")
  }, 30000)

  it("소문자 doctype 으로 시작하는 안내 페이지는 잡는다", async () => {
    const page = `<!doctype html><html><body>국가법령정보 공동활용 미신청</body></html>`
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page, { status: 200 })))

    await expect(new LawApiClient({ apiKey: "test" }).searchLaw("민법")).rejects.toThrow()
  }, 30000)

  it("대문자 DOCTYPE 도 그대로 잡는다 (회귀)", async () => {
    const page = `<!DOCTYPE html><html><body>점검 중</body></html>`
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page, { status: 200 })))

    await expect(new LawApiClient({ apiKey: "test" }).searchLaw("민법")).rejects.toThrow()
  }, 30000)
})
