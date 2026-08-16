/**
 * 라우팅 규칙 회귀 테스트 (#99 #100 #101 #103 #104 #107)
 *
 * 2026-08-16 라우팅 검증 라운드(_workspace/11_qa_route_sweep.md)에서 확정된
 * 감지 규칙 층 결함의 회귀 방지. 각 describe 가 이슈 하나에 대응한다.
 */
import { describe, it, expect } from "vitest"
import { routeQuery } from "./query-router.js"
import { detectScenario } from "../tools/scenarios/index.js"
import { extractActionKeyword } from "../tools/scenarios/action-plan.js"
import { SCENARIO_HOST_CHAINS } from "./scenario-rules.js"
import { allTools } from "../tool-registry.js"
import { resolveLawAlias } from "./search-normalizer.js"

/** 메인 도구 + 파이프라인 도구 전체 (매트릭스 원칙 6: 최종 도달 목적지로 판정) */
function reached(query: string): string[] {
  const r = routeQuery(query)
  return [r.tool, ...(r.pipeline ?? []).map(p => p.tool)]
}

/** 메인 + 파이프라인 파라미터를 한 덩어리 JSON 으로 (파라미터 훼손 검출용) */
function allParams(query: string): string {
  const r = routeQuery(query)
  return JSON.stringify([r.params, ...(r.pipeline ?? []).map(p => p.params)])
}

describe("#99 specific_article 선점 — 후행 의도 양보", () => {
  it("인용 검증 의도가 살아남는다", () => {
    expect(reached("민법 제103조 인용 검증해줘")).toContain("verify_citations")
  })

  it("'맞는지 확인' 형태의 인용 검증도 도달한다", () => {
    const q = "이 인용이 맞는지 확인해줘: 민법 제839조의2에 따르면 재산분할청구권은 이혼한 날부터 2년 내 행사해야 한다"
    expect(reached(q)).toContain("verify_citations")
  })

  it("사건번호 + 검증 어휘도 verify_citations 로 간다", () => {
    expect(reached("민법 제999조의9와 대법원 2099다99999에 따르면 가능하다는데 검증해줘"))
      .toContain("verify_citations")
  })

  it("3단비교 의도가 폐기되지 않는다", () => {
    expect(reached("관세법 제38조 3단비교")).toContain("chain_law_system")
  })

  it("판례 의도가 폐기되지 않는다", () => {
    expect(reached("민법 제103조 판례")).toContain("search_precedents")
  })

  it("개정 이력 의도가 폐기되지 않는다", () => {
    expect(reached("도로교통법 제44조 개정 이력")).toContain("chain_amendment_track")
  })

  it("의도 어휘가 없는 조문 질의는 그대로 조문 조회다", () => {
    expect(reached("「민법」 제103조 알려줘")).toContain("get_law_text")
  })
})

describe("#100 날짜 파싱 선행 — 시점 트리거 소실·검색어 오염", () => {
  it("'최근 N년 이내 개정' 트리거가 살아있다", () => {
    expect(reached("최근 3년 이내 개정된 도로교통법")).toContain("chain_amendment_track")
  })

  it("'YYYY년 이후 개정' 트리거가 살아있다", () => {
    expect(reached("2020년 이후 개정된 관세법")).toContain("chain_amendment_track")
  })

  it("날짜 제거 후 조사 잔재('이내')가 검색어에 남지 않는다", () => {
    expect(allParams("최근 3년 이내 개정된 도로교통법")).not.toContain("이내")
  })

  it("날짜 제거 후 조사 잔재('이랑')가 검색어에 남지 않는다", () => {
    const p = allParams("민법 작년이랑 지금 뭐가 달라")
    expect(p).not.toContain("이랑")
    expect(p).toContain("민법")
  })

  it("날짜 범위는 계속 추출된다", () => {
    expect(routeQuery("최근 3년 음주운전 판례").dateRange).toBeDefined()
  })
})

describe("#101 시나리오 감지 단일 원본 — CLI/MCP 일치", () => {
  const cliScenario = (q: string) => {
    const r = routeQuery(q)
    return (r.params.scenario as string | undefined) ?? null
  }

  it("CLI 와 MCP 가 같은 쿼리에 같은 시나리오를 준다", () => {
    for (const q of [
      "전세금을 못 받고 이사해야 해",
      "전세금을 못 받았습니다",
      "관세 환급을 못 받았어",
      "음주운전 걸렸어",
      "법인세 손금 산입이 되나",
    ]) {
      const r = routeQuery(q)
      expect([q, cliScenario(q)]).toEqual([q, detectScenario(q, r.tool)])
    }
  })

  it("'못 받' 계열이 MCP 경로에서도 action_plan 이다", () => {
    for (const q of [
      "전세금을 못 받고 이사해야 해",
      "전세금을 못 받았습니다",
      "전세금을 돌려받지 못했어요",
      "보증금을 못 돌려받고 있어요",
      "집주인이 전세금을 안 줘",
    ]) {
      expect([q, detectScenario(q, "chain_full_research")]).toEqual([q, "action_plan"])
    }
  })

  it("관세 문맥의 시민 질의도 action_plan 에 도달한다 (customs 선점 해소)", () => {
    expect(detectScenario("관세 환급을 못 받았어", "chain_full_research")).toBe("action_plan")
  })

  it("관세 실무 질의는 여전히 customs 다", () => {
    expect(detectScenario("수입 물품이 감면 대상이 되나", "chain_full_research")).toBe("customs")
    expect(detectScenario("FTA 원산지 증명서 발급 어떻게 해야 하나", "chain_full_research")).toBe("customs")
  })

  it("'되나' 단독은 action_plan 을 오탐하지 않는다", () => {
    expect(detectScenario("법인세 손금 산입이 되나", "chain_full_research")).toBeNull()
    expect(detectScenario("이 계약이 유효하게 되나", "chain_full_research")).toBeNull()
  })

  it("허가 여부를 묻는 '~해도 되나'는 action_plan 이다", () => {
    expect(detectScenario("이거 소송해도 되나", "chain_full_research")).toBe("action_plan")
    expect(detectScenario("전세금 못 받으면 어떻게 되나", "chain_full_research")).toBe("action_plan")
  })

  it("'처벌'이 penalty 시나리오에 도달한다", () => {
    expect(detectScenario("음주운전 처벌 기준 알려줘", "chain_action_basis")).toBe("penalty")
    expect(reached("음주운전 처벌 기준 알려줘")).toContain("chain_action_basis")
  })
})

describe("#101 규칙 테이블 자체의 정합", () => {
  it("모든 hostChain 이 실재하는 도구다", () => {
    // hostChain 은 문자열이라 오타가 나도 컴파일된다 — 그 규칙은 양쪽 표면에서 영구히 죽는다
    const names = new Set(allTools.map(t => t.name))
    for (const host of SCENARIO_HOST_CHAINS) {
      expect([host, names.has(host)]).toEqual([host, true])
    }
  })

  it("붙인 시나리오는 해당 체인의 스키마가 받는 값이다", () => {
    for (const q of [
      "전세금 못 받았어", "관세 통관 절차 확인", "음주운전 처벌 기준 알려줘",
      "관세법 2024 vs 2026", "관세법 위임입법 미이행 현황",
    ]) {
      const r = routeQuery(q)
      const tool = allTools.find(t => t.name === r.tool)
      if (!tool) continue
      expect([q, tool.schema.safeParse(r.params).success]).toEqual([q, true])
    }
  })

  it("감지 어휘를 넓힌 만큼 action_plan 검색어에서도 부정 표현이 걷힌다", () => {
    // 감지기(scenario-rules)와 추출기(action-plan)가 짝 — 한쪽만 넓히면 "관세 환급을 못"이 남는다
    expect(extractActionKeyword("관세 환급을 못 받았어").keyword).not.toMatch(/못\s*$/)
  })
})

describe("#103 조문·별표·전문 추출 소실", () => {
  it("가운뎃점 다중 조문이 모두 전달된다", () => {
    const p = allParams("민법 제309조·제310조")
    expect(p).toContain("제309조")
    expect(p).toContain("제310조")
  })

  it("별표 번호가 annexNo 로 전달된다", () => {
    const p = allParams("도로교통법 시행규칙 별표28")
    expect(reached("도로교통법 시행규칙 별표28")).toContain("get_annexes")
    expect(p).toContain("28")
  })

  it("판결 '전문' 요구가 full=true 로 전달된다", () => {
    expect(allParams("대법원 2022도6643 판결 전문 보여줘")).toContain("\"full\":true")
  })

  it("'제' 생략 표기가 조문 조회 경로에 진입한다", () => {
    expect(reached("도교법 44조")).toContain("get_law_text")
    expect(reached("주임법 3조의3")).toContain("get_law_text")
    expect(reached("형법 1조 2항")).toContain("get_law_text")
  })

  it("'제' 생략 조문번호가 정규 표기로 변환된다", () => {
    expect(allParams("주임법 3조의3")).toContain("제3조의3")
  })

  it("조문 경계는 유지된다 (제1032조를 제103조로 읽지 않는다)", () => {
    const p = allParams("민법 제1032조")
    expect(p).toContain("제1032조")
  })
})

describe("#104 '조례' 명시 없는 자치법규 질의", () => {
  it("지역명 + 행정 주제가 자치법규 경로로 간다", () => {
    expect(reached("광진구 공무원 휴직 규정")).toContain("search_ordinance")
  })

  it("행정구역 접미사를 가진 일반 명사는 자치법규로 오인하지 않는다", () => {
    expect(reached("연구 용역 수수료 규정")).not.toContain("search_ordinance")
  })
})

describe("#107 도로교통법 약칭", () => {
  it("'도교법'이 도로교통법으로 정규화된다", () => {
    expect(resolveLawAlias("도교법").canonical).toBe("도로교통법")
  })

  it("기존 LexDiff 약칭은 그대로 동작한다", () => {
    expect(resolveLawAlias("화물운수법").canonical).toBe("화물자동차 운수사업법")
  })
})
