import { describe, expect, it } from "vitest"
import { ErrorCodes, formatToolError } from "./errors.js"
import { UpstreamRecordMissingError } from "./upstream-miss.js"

// 모듈은 미스 모양을 3값으로 아는데 표면에서 2원인으로 눌려 있었다(#146).
// 권한 안내 페이지는 재시도로 낫지 않는 원인이라 "잠시 후 재시도"만 안내하면
// 사용자는 영원히 낫지 않는 상태를 기다린다.
describe("UPSTREAM_NO_DATA — 안내 페이지의 셋째 원인 (#146)", () => {
  it("빈 본문이면 두 원인만 말한다", () => {
    const text = formatToolError(new UpstreamRecordMissingError("https://x/?OC=***", "empty")).content[0].text
    expect(text).toContain(`[${ErrorCodes.UPSTREAM_NO_DATA}]`)
    expect(text).toContain("둘 중 하나")
    expect(text).not.toContain("인증키(OC)로 해당 API가 신청")
  })

  it("안내 페이지면 인증키 미신청을 셋째 원인으로 밝힌다", () => {
    const text = formatToolError(new UpstreamRecordMissingError("https://x/?OC=***", "html")).content[0].text
    expect(text).toContain("셋 중 하나")
    expect(text).toContain("인증키(OC)로 해당 API가 신청·승인되지 않음")
    expect(text).toContain("open.law.go.kr")
    // 재시도로 낫지 않는다는 사실이 함께 서야 한다
    expect(text).toContain("재시도로 낫지 않습니다")
  })

  it("어느 쪽이든 부존재를 단정하지 않는다 (회귀)", () => {
    for (const kind of ["empty", "html"] as const) {
      const text = formatToolError(new UpstreamRecordMissingError("https://x/?OC=***", kind)).content[0].text
      expect(text).toContain("반환하지 않았습니다")
      expect(text).not.toContain("존재하지 않습니다")
      expect(text).toContain("부존재를 증명하지 않습니다")
    }
  })
})

// 대괄호 라벨은 기계 독자에 대한 계약이므로 상수 밖에서 만들지 않는다(#138).
describe("ErrorCodes — 별표 본문 미추출 라벨", () => {
  it("ANNEX_BODY_UNAVAILABLE 이 상수로 존재한다", () => {
    expect(ErrorCodes.ANNEX_BODY_UNAVAILABLE).toBe("ANNEX_BODY_UNAVAILABLE")
  })
})
