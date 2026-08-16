import { describe, expect, it } from "vitest"
import { truncateResponse, truncateSections } from "./schemas.js"
import { cutAtSafeBoundary, extractSummary } from "./truncate-text.js"

// #92가 최상위에서 세운 계약("안내문 길이를 예산에서 먼저 뺀다" · "하드컷하지 않는다")이
// 두 경로에 관철되지 않았다(#145).

describe("truncateResponse(summary) — 하드컷 대신 경계 절단", () => {
  // extractSummary 는 `maxSize - 100` 예산으로 모으고 꼬리를 뒤에 붙인다. 마지막에
  // 담기는 줄이 길어야 예산을 넘겨 초과 경로를 탄다 — 본문 줄을 길게 잡는 이유다.
  const text = Array.from({ length: 20 }, (_, i) =>
    `▶ 섹션 ${i}\n${"가".repeat(300)}\n${"나".repeat(300)}`).join("\n")
  const max = 500

  it("요약 초과분을 경계에서 자른다 (slice 하드컷 아님)", () => {
    const extracted = extractSummary(text, max)
    expect(extracted.length).toBeGreaterThan(max)   // 이 입력이 초과 경로를 실제로 탄다

    const out = truncateResponse(text, { maxLength: max, summary: true })
    expect(out).toBe(cutAtSafeBoundary(extracted, max))
    expect(out).not.toBe(extracted.slice(0, max))
    expect(out.length).toBeLessThanOrEqual(max)
  })

  it("상한 이내면 그대로 (회귀)", () => {
    expect(truncateResponse("짧은 응답", { maxLength: 1000, summary: true })).toBe("짧은 응답")
  })
})

describe("truncateSections — 섹션 안내문도 예산 안에서 (#145)", () => {
  // 줄 경계가 있어야 cutAtSafeBoundary 가 예산 근처까지 채운다 —
  // 경계 없는 한 덩어리면 훨씬 앞에서 잘려 안내문을 더해도 상한을 안 넘는다.
  const section = (i: number) =>
    `▶ 섹션 ${i}\n` + Array.from({ length: 60 }, () => "가".repeat(50)).join("\n")

  it("섹션마다 perSection을 안내문 길이만큼 넘지 않는다", () => {
    const perSection = 300
    const out = truncateSections([0, 1, 2, 3].map(section).join("\n\n"), 5_000, perSection)

    const parts = out.split(/\n\n(?=▶\s)/)
    expect(parts.length).toBe(4)
    for (const p of parts) {
      expect(p).toContain("축약)")                     // 실제로 절단 경로를 탔는지
      expect(p.length).toBeLessThanOrEqual(perSection)
    }
  })

  it("전체 상한도 계속 지킨다 (회귀)", () => {
    const out = truncateSections([0, 1, 2, 3, 4, 5].map(section).join("\n\n"), 2_000)
    expect(out.length).toBeLessThanOrEqual(2_000)
  })
})
