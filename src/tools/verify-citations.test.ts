import { describe, it, expect } from "vitest"
import { lawNameCandidates, looseMatchLawName, extractLawName } from "./verify-citations.js"

describe("extractLawName — 인용 직전 문맥에서 법령명 추출", () => {
  // 회귀: 「법령명」 제N조 는 법제처·판결문·실무 문서의 표준 표기인데, 닫는 낫표가
  // LAW_NAME_REGEX의 $ 앵커를 막아 법령명이 전혀 추출되지 않았다. 그 결과 조문 실존
  // 검증에 진입하지 못해 없는 조문·없는 항조차 ✗로 잡히지 않았다(환각 탐지 미가동).
  it("낫표로 감싼 표준 표기에서 법령명을 추출한다", () => {
    expect(extractLawName("「식품 등의 표시·광고에 관한 법률」 ")).toBe("식품 등의 표시·광고에 관한 법률")
    expect(extractLawName("이 사건에는 「형법」")).toBe("형법")
    expect(extractLawName("『민법』")).toBe("민법")
  })

  it("낫표 없는 평문은 종전대로 추출 (#55 동작 유지)", () => {
    expect(extractLawName("절도죄는 형법")).toBe("절도죄는 형법")
    expect(extractLawName("전자상거래 등에서의 소비자보호에 관한 법률")).toBe(
      "전자상거래 등에서의 소비자보호에 관한 법률"
    )
  })

  it("접속사·부사 수식어는 제거", () => {
    expect(extractLawName("또한 상법")).toBe("상법")
  })

  it("법령명이 없으면 undefined", () => {
    expect(extractLawName("계약서에 따라")).toBeUndefined()
    expect(extractLawName("")).toBeUndefined()
  })
})

describe("lawNameCandidates", () => {
  it("법령명 직전 캡처(수식어 없음)는 후보 1개", () => {
    expect(lawNameCandidates("형법")).toEqual(["형법"])
  })

  it("앞 수식어가 붙으면 전체→축약 순으로 후보 생성 (#55)", () => {
    expect(lawNameCandidates("절도죄는 형법")).toEqual(["절도죄는 형법", "형법"])
    expect(lawNameCandidates("이혼시 재산분할은 민법")).toEqual([
      "이혼시 재산분할은 민법",
      "재산분할은 민법",
      "민법",
    ])
  })

  it("다어절 법령명은 전체 후보가 먼저 와서 보존된다", () => {
    const cands = lawNameCandidates("전자상거래 등에서의 소비자보호에 관한 법률")
    expect(cands[0]).toBe("전자상거래 등에서의 소비자보호에 관한 법률")
  })

  it("2자 미만 후보는 제외", () => {
    // 마지막 어절이 1자면 후보에서 빠지고, 유효 후보가 없으면 원문 유지
    expect(lawNameCandidates("가 나")).toEqual(["가 나"])
  })
})

describe("looseMatchLawName", () => {
  it("공백 무시 완전 일치", () => {
    expect(looseMatchLawName("형법", "형법")).toBe(true)
  })

  it("공식 법령명이 후보로 시작하면 매칭 (약칭)", () => {
    expect(looseMatchLawName("개인정보", "개인정보 보호법")).toBe(true)
  })

  it("법률/법 접미 정규화로 매칭", () => {
    expect(looseMatchLawName("국가공무원법", "국가공무원법")).toBe(true)
  })

  it("수식어가 남은 후보는 매칭 실패 (조문검증 저하 방지 대상)", () => {
    expect(looseMatchLawName("절도죄는 형법", "형법")).toBe(false)
  })

  it("전혀 다른 법령은 매칭 실패", () => {
    expect(looseMatchLawName("형법", "민법")).toBe(false)
  })
})
