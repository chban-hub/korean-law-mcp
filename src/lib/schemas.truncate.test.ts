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
    expect(out).not.toBe(extracted.slice(0, max))
    expect(out.length).toBeLessThanOrEqual(max)
  })

  // 재절단이 문서 끝에서 자르면 맨 끝에 붙는 `📋 요약 모드` 꼬리부터 사라진다 —
  // 절단·요약 사실이 무표기가 된다(#150). 꼬리 길이를 예산에서 예약해야 한다.
  it("재절단 후에도 요약 모드 꼬리가 남는다 (#150 무표기 절단 금지)", () => {
    const out = truncateResponse(text, { maxLength: max, summary: true })
    expect(out.length).toBeLessThanOrEqual(max)
    expect(out).toMatch(/📋 요약 모드: 원문 [\d,]+자 중 핵심만 추출 \([\d,]+자\)$/)
  })

  it("상한 이내면 그대로 (회귀)", () => {
    expect(truncateResponse("짧은 응답", { maxLength: 1000, summary: true })).toBe("짧은 응답")
  })
})

describe("하드컷 서로게이트 쌍 보호 (#150)", () => {
  // `𠮷`(U+20BB7)는 UTF-16 유닛 2개다. 하드컷이 쌍 한가운데를 끊으면 isWellFormed()가
  // 깨지고, JSON 직렬화 시 U+FFFD로 변형돼 전송된다.
  it("cutAtSafeBoundary 폴백(경계 없음)이 아스트랄 문자를 반토막 내지 않는다", () => {
    const text = "가".repeat(499) + "𠮷" + "나".repeat(600)  // 경계(줄·문장부호) 없음
    const out = cutAtSafeBoundary(text, 500)                  // 500번째 유닛이 high surrogate
    expect(out.isWellFormed()).toBe(true)
    expect(out.length).toBeLessThanOrEqual(500)
  })

  it("truncateResponse 극소 예산(안내문보다 작음) 경로도 안전하다", () => {
    const text = "가".repeat(19) + "𠮷" + "나".repeat(100)
    const out = truncateResponse(text, 20)                    // notice 예산이 안 나와 slice 폴백
    expect(out.isWellFormed()).toBe(true)
  })

  it("truncateSections 최종 재절단 폴백도 안전하다", () => {
    const head = "▶ 제목\n"
    const body = "가".repeat(19 - head.length) + "𠮷" + "나".repeat(30)
    const out = truncateSections(head + body, 20, 300)        // 전체 상한 20 < 안내문 길이
    expect(out.isWellFormed()).toBe(true)
  })

  it("아스트랄 문자만으로 된 입력을 어느 예산으로 잘라도 온전하다", () => {
    const text = "𠮷".repeat(60)
    for (let maxSize = 15; maxSize <= 60; maxSize++) {
      expect(truncateResponse(text, maxSize).isWellFormed(), `maxSize=${maxSize}`).toBe(true)
      expect(cutAtSafeBoundary(text, maxSize).isWellFormed(), `budget=${maxSize}`).toBe(true)
    }
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
