import { describe, expect, it } from "vitest"
import { getAnnexes } from "./annex.js"
import type { LawApiClient } from "../lib/api-client.js"

// licbyl 검색 인덱스 응답 (실측 축약) — 세 항목이 같은 법령일련번호를 가리킨다
const licbyl = (mst = "283481") => JSON.stringify({
  licBylSearch: {
    resultMsg: "success",
    licbyl: [
      { 별표번호: "002800", 별표명: "운전면허 취소·정지처분 기준", 별표종류: "별표",
        별표서식파일링크: "/LSW/flDownload.do?flSeq=1", 관련법령명: "도로교통법 시행규칙", 관련법령일련번호: mst },
      { 별표번호: "000600", 별표명: "과태료 부과기준", 별표종류: "별표",
        별표서식파일링크: "/LSW/flDownload.do?flSeq=2", 관련법령명: "도로교통법 시행규칙", 관련법령일련번호: mst },
    ],
  },
})

/** 현행 본문(lawService)에 licbyl에 없는 별표가 하나 더 있는 상태 */
const lawBody = JSON.stringify({
  법령: {
    별표: {
      별표단위: [
        { 별표번호: "0028", 별표가지번호: "00", 별표구분: "별표", 별표제목: "운전면허 취소·정지처분 기준",
          별표서식파일링크: "/LSW/flDownload.do?flSeq=1" },
        { 별표번호: "0099", 별표가지번호: "00", 별표구분: "별표", 별표제목: "신설된 별표99",
          별표서식파일링크: "/LSW/flDownload.do?flSeq=9" },
      ],
    },
  },
})

const stub = (fetchApi: () => Promise<string>) => ({
  getAnnexes: async () => licbyl(),
  fetchApi,
}) as unknown as LawApiClient

describe("get_annexes 병합 소스 조회 실패 표기 (#127)", () => {
  // 기본 2MiB 예산에서 도로교통법 시행규칙 본문(3.77MB)이 거부되면 이 경로가 탄다.
  // 종전에는 catch가 실패를 삼켜 #77 신설 별표 병합이 조용히 빠진 채 성공 반환됐다.
  it("현행 본문 조회가 실패하면 병합 미확인을 명시한다", async () => {
    const r = await getAnnexes(stub(async () => { throw new Error("body budget exceeded") }), {
      lawName: "도로교통법 시행규칙", display: 20,
    } as never)
    expect(r.content[0].text).toContain("신설 별표 병합 확인 불가")
    expect(r.content[0].text).toContain("현행 본문 조회 실패")
  })

  it("목록 자체는 유효하므로 isError로 올리지 않는다", async () => {
    const r = await getAnnexes(stub(async () => { throw new Error("boom") }), {
      lawName: "도로교통법 시행규칙", display: 20,
    } as never)
    expect(r.isError).toBeFalsy()
    expect(r.content[0].text).toContain("002800")
  })

  it("조회에 성공하면 마커 없이 신설 별표를 병합한다", async () => {
    const r = await getAnnexes(stub(async () => lawBody), {
      lawName: "도로교통법 시행규칙", display: 20,
    } as never)
    expect(r.content[0].text).not.toContain("병합 확인 불가")
    expect(r.content[0].text).toContain("신설된 별표99")
  })

  it("법령일련번호가 확정되지 않아도 병합 미수행을 알린다", async () => {
    const noMst = {
      getAnnexes: async () => licbyl(""),
      fetchApi: async () => lawBody,
    } as unknown as LawApiClient
    const r = await getAnnexes(noMst, { lawName: "도로교통법 시행규칙", display: 20 } as never)
    expect(r.content[0].text).toContain("신설 별표 병합 확인 불가")
  })
})
