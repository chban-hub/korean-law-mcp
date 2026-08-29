import { describe, it, expect } from "vitest"
import { getHistoricalLaw } from "./historical-law.js"
import type { LawApiClient } from "../lib/api-client.js"

// 실제 lawService(target=law) JSON 축약 — 법령명은 "법령명_한글" 키, 소관부처는 {content} 객체,
// 조문은 법령.조문.조문단위[]로 **한 겹 감싸서** 온다(2026-08-29 실측 아동복지법 MST 285697).
// 장·절 헤더는 같은 배열에 조문여부="전문"으로 섞이고, 조문 본문은 조문내용이 아니라 항·호에 있다.
const HIST_JSON = JSON.stringify({
  법령: {
    기본정보: {
      법령명_한글: "상법",
      시행일자: "20260910",
      공포일자: "20250909",
      공포번호: "21044",
      제개정구분명: "일부개정",
      소관부처: { content: "법무부", 소관부처코드: "1270000" },
    },
    조문: {
      조문단위: [
        { 조문번호: "1", 조문여부: "전문", 조문내용: "        제1편 총칙" },
        { 조문번호: "1", 조문여부: "조문", 조문제목: "목적", 조문내용: ["제1조(목적)", "이 법은 상사에 관하여…"] },
        {
          조문번호: "2", 조문가지번호: "3", 조문여부: "조문", 조문제목: "적용범위",
          조문내용: "제2조의3(적용범위)",
          항: [{ 항번호: "①", 항내용: "① 이 법은 상행위에 적용한다." }],
        },
      ],
    },
  },
})

const client = { fetchApi: async () => HIST_JSON } as unknown as LawApiClient

describe("getHistoricalLaw — JSON 객체 필드 안전 문자열화", () => {
  it("소관부처 객체·법령명_한글 키·조문내용 배열을 훼손 없이 출력", async () => {
    const r = await getHistoricalLaw(client, { mst: "273629" })
    const t = r.content[0].text
    expect(t).toContain("법령명: 상법")          // 종전엔 N/A
    expect(t).toContain("소관부처: 법무부")       // 종전엔 [object Object]
    expect(t).toContain("이 법은 상사에")          // 배열 조문내용 평탄화
    expect(t).not.toContain("[object Object]")
  })
})

// 회귀 (#153 곁가지 2): law.조문을 조문 객체의 배열로 읽어 조문단위 래퍼 하나만 잡히면서
// 조문 목록이 "제undefined조" 한 줄로 무너졌다.
describe("getHistoricalLaw — 조문단위 래퍼를 풀어 읽는다 (#153)", () => {
  it("조문번호가 undefined로 새지 않고 실제 조문이 잡힌다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629" })).content[0].text
    expect(t).not.toContain("undefined")
    expect(t).toContain("제1조 (목적)")
  })

  it("조문여부=전문(장·절 헤더)은 조문 수에서 제외한다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629" })).content[0].text
    expect(t).toContain("조문 (총 2개)")           // 전문 1건을 세면 3개가 된다
    expect(t).not.toContain("제1편 총칙")
  })

  it("가지번호 조문은 '제2조의3'으로 표시하고 항 본문까지 편다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629" })).content[0].text
    expect(t).toContain("제2조의3 (적용범위)")
    expect(t).toContain("이 법은 상행위에 적용한다")  // 조문내용은 제목줄뿐 — 항을 안 펴면 빈다
  })

  it("jo 지정 조회가 가지번호까지 맞춰 찾는다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629", jo: "제2조의3" })).content[0].text
    expect(t).toContain("제목: 적용범위")
    expect(t).toContain("이 법은 상행위에 적용한다")
    expect(t).not.toContain("[NOT_FOUND]")
  })

  it("없는 조문은 NOT_FOUND와 함께 실제 조문 목록을 안내한다", async () => {
    const t = (await getHistoricalLaw(client, { mst: "273629", jo: "제99조" })).content[0].text
    expect(t).toContain("[NOT_FOUND]")
    expect(t).toContain("- 제1조 목적")
    expect(t).toContain("- 제2조의3 적용범위")
  })
})
