import { describe, it, expect } from "vitest"
import { runTimeTravelScenario } from "./time-travel.js"
import type { LawApiClient } from "../../lib/api-client.js"
import type { ScenarioContext } from "./types.js"

// 회귀 (2026-08-19 형사소송법 실측): lsHistory는 분리시행 공포본을 같은 MST의
// 여러 행으로 내보낸다 (MST 281865 = 시행 20260701 + 20271231). 연혁 dedup을
// MST+시행일 쌍으로 고친 뒤 두 슬라이스가 모두 남으므로, 두 시점이 한 공포본
// 안에서 갈리는 경우가 처음으로 도달 가능해진다. 이때
//   (a) MST만 비교하면 "변경 없음"으로 단정하고 (실제로는 조문 644 vs 653개)
//   (b) 본문을 target=law&MST로 집으면 두 시점 모두 마지막 슬라이스(20271231)를
//       받아 diff가 통째로 비어버린다 — MST는 공포본 단위라 시행일을 못 푼다.
// 본문 조회는 efYd를 동반한 eflaw여야 시점별 본문이 갈린다.

const histPage = (rows: string[]) =>
  `<html><body><strong>${rows.length}</strong> 건<table>${rows.join("")}</table></body></html>`

const histRow = (mst: string, efYd: string, ancNo: string) =>
  `<tr><td><a href="/lsInfoP.do?MST=${mst}&efYd=${efYd}">형사소송법</a></td><td>제${ancNo}호</td><td>2026.6.9</td><td>일부개정</td></tr>`

const lawBody = (efYd: string, articles: string[]) => JSON.stringify({
  법령: {
    기본정보: { 법령명_한글: "형사소송법", 시행일자: efYd, 공포번호: "21241", 공포일자: "20260609", 제개정구분명: "일부개정" },
    조문: {
      조문단위: articles.map((content, i) => ({
        조문여부: "조문", 조문번호: String(i + 1), 조문제목: `제${i + 1}조`, 조문내용: content,
      })),
    },
  },
})

// 20260701 슬라이스: 2개 조문 / 20271231 슬라이스: 3개 조문(제3조 신설)
const SLICE_BODIES: Record<string, string> = {
  "20260701": lawBody("20260701", ["제1조 내용", "제2조 내용"]),
  "20271231": lawBody("20271231", ["제1조 내용", "제2조 내용", "제3조 신설 내용"]),
}

function makeCtx(seen: string[]): ScenarioContext {
  const apiClient = {
    async fetchApi(p: { endpoint: string; target: string; extraParams?: Record<string, string> }) {
      const ep = p.extraParams || {}
      seen.push(`${p.target}:${ep.MST || ""}:${ep.efYd || ""}`)
      if (p.target === "lsHistory") {
        return histPage([histRow("281865", "20271231", "21241"), histRow("281865", "20260701", "21241")])
      }
      if (p.target === "eflaw" && ep.efYd) return SLICE_BODIES[ep.efYd] ?? "{}"
      // target=law는 MST만 받으므로 언제나 마지막 슬라이스를 돌려준다 (실 API 거동)
      return SLICE_BODIES["20271231"]
    },
  } as unknown as LawApiClient

  return {
    apiClient,
    query: "형사소송법",
    law: { lawName: "형사소송법", lawId: "001234", mst: "281865", lawType: "법률" },
    extras: { fromDate: "20260801", toDate: "20280101" },
  }
}

describe("time_travel — 분리시행 슬라이스", () => {
  it("같은 MST의 다른 시행일이면 '변경 없음'으로 끊지 않고 diff를 낸다", async () => {
    const seen: string[] = []
    const result = await runTimeTravelScenario(makeCtx(seen))
    const text = result.sections.map(s => s.content).join("\n")

    expect(text).not.toContain("변경 없음")
    expect(text).toContain("제3조")
  })

  it("본문은 efYd를 동반한 eflaw로 시점별로 집는다", async () => {
    const seen: string[] = []
    await runTimeTravelScenario(makeCtx(seen))

    expect(seen).toContain("eflaw:281865:20260701")
    expect(seen).toContain("eflaw:281865:20271231")
    expect(seen.some(s => s.startsWith("law:"))).toBe(false)
  })
})
