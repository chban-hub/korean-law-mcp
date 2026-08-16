import { describe, it, expect } from "vitest"
import { MAX_RESPONSE_SIZE, truncateResponse, truncateSections } from "./schemas.js"

// 판례 full 응답을 모사: 한 문장이 여러 줄에 걸치는 긴 한글 산문.
function longKoreanProse(chars: number): string {
  const sentence = "원심판결 이유를 관련 법리와 기록에 비추어 살펴보면 원심의 판단에 상고이유 주장과 같이 " +
    "법리를 오해하거나 필요한 심리를 다하지 아니한 잘못이 없다. "
  let out = ""
  while (out.length < chars) out += sentence
  return out.slice(0, chars)
}

describe("truncateResponse 한도 보장 (#92)", () => {
  it("잘린 응답도 maxSize를 초과하지 않는다", () => {
    const out = truncateResponse(longKoreanProse(60000))
    expect(out.length).toBeLessThanOrEqual(MAX_RESPONSE_SIZE)
  })

  it("명시 maxSize에서도 한도를 초과하지 않는다", () => {
    const out = truncateResponse(longKoreanProse(5000), 1000)
    expect(out.length).toBeLessThanOrEqual(1000)
  })

  it("truncateSections 전체 한도도 초과하지 않는다", () => {
    const text = ["▶ 섹션1", longKoreanProse(30000), "", "▶ 섹션2", longKoreanProse(30000)].join("\n")
    const out = truncateSections(text, 2000)
    expect(out.length).toBeLessThanOrEqual(2000)
  })

  it("한도 이하 입력은 그대로 반환한다", () => {
    const text = "짧은 응답"
    expect(truncateResponse(text)).toBe(text)
  })
})

describe("truncateResponse 문장 경계 가드 (#92)", () => {
  // 안내문을 뺀 본문 말미가 문장/줄 중간에서 끊기면 법적 실질(보충·반대의견 말미)이
  // 문장 도중 소실된다. 컷은 마지막 완결 경계로 후퇴해야 한다.
  const bodyOf = (out: string) => out.split("\n\n⚠️")[0]

  it("문장 중간에서 끊지 않는다 (마지막 종결부호 뒤로 후퇴)", () => {
    const out = truncateResponse(longKoreanProse(5000), 1000)
    const body = bodyOf(out)
    expect(body.trimEnd().endsWith("다.")).toBe(true)
  })

  it("줄 경계가 있으면 줄 단위로 후퇴한다", () => {
    const line = "제1조(목적) 이 법은 국민의 권리를 보호함을 목적으로 한다.\n"
    const text = line.repeat(200)
    const body = bodyOf(truncateResponse(text, 1000))
    expect(body.endsWith("한다.")).toBe(true)
  })

  it("경계 후퇴로 잃는 분량은 상한 이내다 (과대 손실 금지)", () => {
    const out = truncateResponse(longKoreanProse(5000), 1000)
    const body = bodyOf(out)
    // 후퇴 상한(수백 자) 밖으로 본문을 더 버리면 안 된다
    expect(body.length).toBeGreaterThan(1000 - 500)
  })

  it("경계가 전혀 없는 텍스트는 후퇴하지 않는다 (극단적 장문 방어)", () => {
    const noBoundary = "가".repeat(5000)
    const body = bodyOf(truncateResponse(noBoundary, 1000))
    // 후퇴할 경계가 없으면 하드컷 유지 — 무단 손실 0
    expect(body.length).toBeGreaterThan(1000 - 60)
  })
})
