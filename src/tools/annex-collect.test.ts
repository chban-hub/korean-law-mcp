import { describe, expect, it, vi } from "vitest"
import { collectAdminAnnexList, collectAnnexList, ANNEX_PAGE_SIZE, MAX_ANNEX_PAGES } from "./annex-list.js"
import type { LawApiClient } from "../lib/api-client.js"

/** licbyl 봉투 한 페이지. issuer 로 발행 주체를 갈라 준다 */
function page(items: Array<{ no: string, name: string, issuer?: string }>, totalCnt: number) {
  return JSON.stringify({
    licBylSearch: {
      totalCnt: String(totalCnt),
      licbyl: items.map((i) => ({
        별표번호: i.no, 별표명: i.name, 별표종류: "별표",
        ...(i.issuer ? { 관련자치법규명: i.issuer } : {}),
      })),
    },
  })
}

const filled = (n: number, issuer: string, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ no: String(offset + i + 1), name: "과태료 부과기준", issuer }))

function clientReturning(pages: string[]): LawApiClient {
  let call = 0
  return { getAnnexes: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]) } as unknown as LawApiClient
}

// 수집 목록은 여러 법령·자치법규가 섞여 온다(그래서 뒤에 filterByRelatedLawName 이 돈다).
// identity 가 발행 주체를 안 보면 지자체만 다른 동명 별표가 서로를 지우고,
// "새 항목 0건" 방어가 정상 수집을 끊는다(N2).
describe("collectAnnexList — 중복 방어 키에 발행 주체 (N2)", () => {
  it("지자체만 다른 동명 별표를 서로 다른 항목으로 센다", async () => {
    const client = clientReturning([
      page(filled(100, "광진구 과태료 조례"), 264),
      page(filled(100, "서초구 과태료 조례"), 264),
      page(filled(64, "종로구 과태료 조례"), 264),
    ])

    const result = await collectAnnexList(client, { lawName: "과태료 조례" })
    expect(result.list.length).toBe(264)
    expect(result.truncated).toBe(false)
  })
})

describe("collectAnnexList — 절단 사유 (N3·N4)", () => {
  it("업스트림이 page를 무시하면 사유가 no-progress", async () => {
    const same = page(filled(100, "A"), 300)
    const result = await collectAnnexList(clientReturning([same, same, same]), { lawName: "x" })
    expect(result.truncated).toBe(true)
    expect(result.reason).toBe("no-progress")
  })

  it("페이지 상한까지 받고도 남으면 page-cap", async () => {
    const total = (MAX_ANNEX_PAGES + 2) * ANNEX_PAGE_SIZE
    const pages = Array.from({ length: MAX_ANNEX_PAGES }, (_, p) =>
      page(filled(ANNEX_PAGE_SIZE, "A", p * ANNEX_PAGE_SIZE), total))
    const result = await collectAnnexList(clientReturning(pages), { lawName: "x" })
    expect(result.truncated).toBe(true)
    expect(result.reason).toBe("page-cap")
  })

  it("총계를 모른 채 정확히 한 페이지만 오면 무음이 아니라 unknown-total (N4)", async () => {
    const result = await collectAnnexList(clientReturning([page(filled(100, "A"), 0)]), { lawName: "x" })
    expect(result.list.length).toBe(ANNEX_PAGE_SIZE)
    expect(result.truncated).toBe(true)
    expect(result.reason).toBe("unknown-total")
  })

  it("총계 미만이면 절단이 아니다 (회귀)", async () => {
    const result = await collectAnnexList(clientReturning([page(filled(7, "A"), 7)]), { lawName: "x" })
    expect(result.truncated).toBe(false)
    expect(result.reason).toBeUndefined()
  })
})

// #148의 페이지 수집이 licbyl 사다리에만 붙어 4차 admbyl 폴백은 100건 창에 남았다(#149).
describe("collectAdminAnnexList — admbyl 폴백도 같은 수집 정책 (#149)", () => {
  it("page를 이어 받아 100건을 넘긴다", async () => {
    const adminPage = (items: number, offset: number, total: number) => JSON.stringify({
      admRulBylSearch: {
        totalCnt: String(total),
        admrulbyl: Array.from({ length: items }, (_, i) => ({
          별표번호: String(offset + i + 1), 별표명: `서식 ${offset + i + 1}`, 별표종류: "서식",
        })),
      },
    })
    const bodies = [adminPage(100, 0, 150), adminPage(50, 100, 150)]
    let call = 0
    const client = { fetchApi: vi.fn(async () => bodies[Math.min(call++, bodies.length - 1)]) } as unknown as LawApiClient

    const result = await collectAdminAnnexList(client, { lawName: "사료 등의 기준 및 규격" })
    expect(result.list.length).toBe(150)
    expect(result.truncated).toBe(false)
    expect(result.type).toBe("admin")
  })
})
