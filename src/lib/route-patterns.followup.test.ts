/**
 * 라우팅 후속 결함 회귀 테스트 (#119 #120 #121 #122 #123)
 *
 * 규칙 통합(#99~#104) 이후 남은 선존재 결함 + 통합이 드러낸 구조 문제.
 */
import { describe, it, expect } from "vitest"
import { routeQuery } from "./query-router.js"
import { allTools } from "../tool-registry.js"

function reached(query: string): string[] {
  const r = routeQuery(query)
  return [r.tool, ...(r.pipeline ?? []).map(p => p.tool)]
}

function mainQuery(query: string): unknown {
  return routeQuery(query).params.query
}

describe("#119 검색계 추출이 검색어를 훼손하지 않는다", () => {
  it("빈 검색어를 업스트림으로 보내지 않는다", () => {
    // "관세 해석" 은 트리거 어휘가 곧 쿼리 전부 — 지우고 나면 빈 문자열이 남았다
    for (const q of ["관세 해석", "해석례", "판례", "행정심판", "조세 심판", "통합 검색"]) {
      const r = routeQuery(q)
      const v = r.params.query
      if (typeof v === "string") {
        expect([q, v.trim().length > 0]).toEqual([q, true])
      }
    }
  })

  it("트리거 어휘가 공백을 포함해도 반쪽만 남지 않는다", () => {
    expect(mainQuery("유권 해석 근로시간")).toBe("근로시간")
    expect(mainQuery("조세 심판 부가세")).toBe("부가세")
    expect(mainQuery("공정거래 위원회 담합")).toBe("담합")
    expect(mainQuery("개인정보 보호 위원회 유출")).toBe("유출")
    expect(mainQuery("노동 위원회 부당해고")).toBe("부당해고")
    expect(mainQuery("통합 검색 음주운전")).toBe("음주운전")
  })

  it("어휘를 절단하지 않는다 ('선의' → '선')", () => {
    expect(mainQuery("법령 용어 선의")).toBe("선의")
  })
})

describe("#120 full 미지원 도구에서 의도가 무음 소멸하지 않는다", () => {
  it("full 을 받는 상세도구에는 전달된다", () => {
    const r = routeQuery("대법원 2022도6643 판결 전문 보여줘")
    expect(JSON.stringify(r.pipeline)).toContain("\"full\":true")
  })

  it("full 을 받지 못하는 상세도구면 경고 표면화를 위해 표시를 남긴다", () => {
    // 자치법규 상세(get_ordinance)는 full 을 받지 않는다
    const r = routeQuery("서울시 주차 조례 전문 보여줘")
    expect(r.unsupportedParams).toContain("full")
  })
})

describe("#121 대형 입력에서 라우팅이 선형 시간에 가깝다", () => {
  it("8k자 입력이 100ms 안에 끝난다", () => {
    const q = "광진구 " + "가나다라마바사아자차카타파하 ".repeat(600)
    const t = Date.now()
    routeQuery(q)
    expect([q.length, Date.now() - t < 100]).toEqual([q.length, true])
  })

  it("길이를 4배로 늘려도 비용이 제곱으로 뛰지 않는다", () => {
    // O(n²) 였을 때 9k자 487ms / 36k자 7.6초. 선형이면 4배 길이에 4배 남짓이어야 한다.
    const build = (n: number) => "광진구 " + "가나다라마바사아자차카타파하 ".repeat(n)
    const time = (s: string) => {
      const t = performance.now()
      for (let i = 0; i < 5; i++) routeQuery(s)
      return (performance.now() - t) / 5
    }
    time(build(100)) // warm-up
    const a = time(build(600))
    const b = time(build(2400))
    const ratio = b / Math.max(a, 0.05)
    expect([`${a.toFixed(2)}ms→${b.toFixed(2)}ms (${ratio.toFixed(1)}x)`, ratio < 8])
      .toEqual([`${a.toFixed(2)}ms→${b.toFixed(2)}ms (${ratio.toFixed(1)}x)`, true])
  })

  it("체인 도구 query 스키마에 길이 상한이 있다", () => {
    for (const name of ["chain_full_research", "chain_action_basis", "chain_law_system"]) {
      const tool = allTools.find(t => t.name === name)
      const res = tool?.schema.safeParse({ query: "가".repeat(50_000) })
      expect([name, res?.success]).toEqual([name, false])
    }
  })
})

describe("#122 라우팅 어휘·우선순위 공백", () => {
  it("'바뀌었/달라졌' 이 개정 이력 경로로 간다", () => {
    expect(reached("도로교통법 언제 바뀌었어?")).toContain("chain_amendment_track")
    expect(reached("민법 뭐가 달라졌어")).toContain("chain_amendment_track")
  })

  it("cite_check 이 '키워드 → 사건번호' 역순도 잡는다", () => {
    expect(reached("이 판례 아직 유효해? 2013다61381")).toContain("cite_check")
    expect(JSON.stringify(routeQuery("이 판례 아직 유효해? 2013다61381").params)).toContain("2013다61381")
  })

  it("'무렵에' 시점 표현이 applicable_law 로 간다", () => {
    expect(reached("2023년 5월 10일 무렵에 시행되던 도로교통법 제44조 당시 적용"))
      .toContain("applicable_law")
  })

  it("상위법 저촉 질의가 조례비교(compliance) 경로로 간다", () => {
    const r = routeQuery("서울시 조례가 상위법에 저촉되나")
    expect([r.tool, r.params.scenario]).toEqual(["chain_ordinance_compare", "compliance"])
  })
})

describe("#123 양보 가드가 수신 패턴에서 파생된다", () => {
  it("수신 패턴에만 어휘를 추가해도 가드가 함께 넓어진다", () => {
    // 가드가 별도 복사본이면 이 조합에서 specific_article(pri 1)이 선점한다
    expect(reached("민법 제103조 신구대조")).toContain("chain_amendment_track")
    expect(reached("관세법 제38조 위임 조문")).toContain("chain_law_system")
  })

  it("기존 양보 동작은 그대로다", () => {
    expect(reached("민법 제103조 인용 검증해줘")).toContain("verify_citations")
    expect(reached("민법 제103조 인용한 판례 보여줘")).toContain("impact_map")
    expect(reached("2023.5.10 당시 도로교통법 제44조")).toContain("applicable_law")
    expect(reached("「민법」 제103조 알려줘")).toContain("get_law_text")
  })
})
