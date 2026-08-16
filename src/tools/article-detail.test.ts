import { describe, it, expect } from "vitest"
import { getArticleDetail } from "./article-detail.js"
import type { LawApiClient } from "../lib/api-client.js"

function client(): LawApiClient {
  return {
    fetchApi: async () => JSON.stringify({
      법령: {
        기본정보: { 법령명_한글: "상법" },
        조문: { 조문단위: { 조문여부: "조문", 조문번호: "401", 조문가지번호: "2", 조문제목: "업무집행지시자 등의 책임", 조문내용: "제401조의2(업무집행지시자 등의 책임) …" } },
      },
    }),
  } as unknown as LawApiClient
}

describe("getArticleDetail — 조회 위치 라벨 (#118)", () => {
  it("의X 조문에 '조'를 덧붙이지 않는다", async () => {
    const r = await getArticleDetail(client(), { jo: "제401조의2", mst: "272919" })
    const text = r.content[0].text
    expect(text).toContain("조회 위치: 제401조의2")
    expect(text).not.toContain("제401조의2조")
  })

  it("보통 조문 표기는 종전대로", async () => {
    const r = await getArticleDetail(client(), { jo: "제44조", mst: "281875" })
    expect(r.content[0].text).toContain("조회 위치: 제44조")
  })

  it("JO 코드 입력은 자연어 표기로 보여준다", async () => {
    const r = await getArticleDetail(client(), { jo: "040102", mst: "272919" })
    expect(r.content[0].text).toContain("조회 위치: 제401조의2")
  })
})
