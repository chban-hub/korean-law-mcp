import { describe, it, expect } from "vitest"
import { discoverTools } from "./meta-tools.js"
import { TOOL_ALIASES, TOOL_CATEGORIES } from "../lib/tool-profiles.js"
// import 부수효과로 setAllToolsRef(allTools)가 실행된다 — discover_tools가 도구
// 설명을 읽으려면 이 주입이 선행돼야 하므로 레지스트리를 직접 import한다.
import { allTools } from "../tool-registry.js"

const apiClient = {} as never

/** discover_tools 출력에서 `[카테고리]` 헤더를 순서대로 뽑는다. */
async function discoverSections(intent: string): Promise<string[]> {
  const res = await discoverTools(apiClient, { intent })
  const text = res.content.map(c => c.text).join("\n")
  return [...text.matchAll(/^\[([^\]]+)\]$/gm)].map(m => m[1])
}

async function discoverText(intent: string): Promise<string> {
  const res = await discoverTools(apiClient, { intent })
  return res.content.map(c => c.text).join("\n")
}

describe("TOOL_ALIASES ↔ TOOL_CATEGORIES 정합 (#102)", () => {
  // 회귀: 별칭 키는 resolveAliasToCategory의 반환값이자 TOOL_CATEGORIES 조회 키다.
  // 카테고리에 없는 키는 "해석은 되는데 아무것도 안 나오는" 무음 실패가 된다.
  it("모든 별칭 키는 실재하는 카테고리 키다", () => {
    const categories = new Set(Object.keys(TOOL_CATEGORIES))
    const orphans = Object.keys(TOOL_ALIASES).filter(key => !categories.has(key))
    expect(orphans).toEqual([])
  })

  it("카테고리가 가리키는 도구는 모두 allTools에 존재한다", () => {
    const names = new Set(allTools.map(t => t.name))
    const ghosts = Object.entries(TOOL_CATEGORIES).flatMap(([category, tools]) =>
      tools.filter(t => !names.has(t)).map(t => `${category} → ${t}`)
    )
    expect(ghosts).toEqual([])
  })

  // snake_case 별칭은 도구를 직접 가리키는 용도다 (영어 단어 별칭 treaty·citator는 제외).
  it("snake_case 별칭은 모두 실재하는 도구다", () => {
    const names = new Set(allTools.map(t => t.name))
    const ghosts = Object.entries(TOOL_ALIASES).flatMap(([key, aliases]) =>
      aliases.filter(a => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(a) && !names.has(a)).map(a => `${key} → ${a}`)
    )
    expect(ghosts).toEqual([])
  })
})

describe("discover_tools — 한국어 별칭 해석 (#102)", () => {
  it.each([
    ["계약서 검토", "analyze_document"],
    ["약관 검토", "analyze_document"],
    ["과태료 기준", "chain_action_basis"],
    ["과징금 기준", "chain_action_basis"],
    ["영업정지 기간", "chain_action_basis"],
    ["처리 절차", "chain_procedure_detail"],
    ["신청 방법", "chain_procedure_detail"],
    ["수수료", "chain_procedure_detail"],
    ["환각 검증", "verify_citations"],
    ["조문 실존 확인", "verify_citations"],
  ])("intent=%s → %s 안내", async (intent, tool) => {
    const text = await discoverText(intent)
    expect(text).not.toContain("찾지 못했습니다")
    expect(text).toContain(tool)
  })
})

describe("discover_tools — 별칭 부분일치 경계 (#106)", () => {
  // 회귀: 양방향 부분일치(alias.includes(q))는 짧은 질의를 긴 별칭이 흡수했다.
  it("'판례'가 '조세심판례' 별칭에 흡수되지 않는다", async () => {
    expect(await discoverSections("판례")).not.toContain("조세심판")
  })

  // 회귀: '행정규칙' ⊃ '규칙'(자치법규 별칭)이라 낱말 경계 없는 부분일치가 오해석했다.
  it("'행정규칙'이 자치법규로 해석되지 않는다", async () => {
    expect(await discoverSections("행정규칙")).not.toContain("자치법규")
  })

  it("정상 별칭 매칭은 유지된다", async () => {
    expect(await discoverSections("조세심판원")).toContain("조세심판")
    expect(await discoverSections("부당해고")).toContain("노동위")
    expect(await discoverSections("청탁금지법")).toContain("권익위")
    expect(await discoverSections("판례 유효성")).toContain("판례생사")
  })

  it("등록되지 않은 어휘는 종전대로 무매칭", async () => {
    expect(await discoverText("하자")).toContain("찾지 못했습니다")
  })
})

describe("도구명 별칭은 레지스트리 실재로 판정 (#108)", () => {
  // 회귀: 판정이 접두사 열거(/^(search_|chain_|verify_|get_|analyze_)/)였던 탓에
  // 접두사 없는 cite_check·applicable_law가 도구로 인식되지 않았다.
  it.each(["cite_check", "applicable_law", "verify_citations", "analyze_document"])(
    "intent=%s는 별칭 매칭 섹션을 만든다",
    async name => {
      const sections = await discoverSections(name)
      expect(sections.some(s => s.startsWith("별칭 매칭"))).toBe(true)
    }
  )

  it("도구가 아닌 영어 별칭(citator·treaty)은 도구로 오인하지 않는다", async () => {
    const sections = await discoverSections("citator")
    expect(sections.some(s => s.startsWith("별칭 매칭"))).toBe(false)
    expect(sections).toContain("판례생사")
  })
})

describe("카테고리 등재 누락 (#109)", () => {
  // discover_tools 카테고리 탐색으로 도달해야 하는 도구들.
  // 노출 도구(V3_EXPOSED)가 디스커버리에서 빠지면 "안내가 노출 도구를 모르는" 역설이 된다.
  it.each([
    "legal_research", "legal_analysis", "search_decisions", "get_decision_text",
    "impact_map", "ordinance_radar", "chain_law_system", "chain_dispute_prep",
    "chain_amendment_track", "chain_ordinance_compare", "chain_full_research",
  ])("%s는 어떤 카테고리에든 등재돼 있다", tool => {
    const homes = Object.entries(TOOL_CATEGORIES).filter(([, tools]) => tools.includes(tool))
    expect(homes.map(([c]) => c)).not.toEqual([])
  })

  // 메타 도구는 의도적 제외 — 자기 출력에 자기를 싣는 자기참조이고, 둘 다 항상 노출된다.
  it.each(["discover_tools", "execute_tool"])("메타 도구 %s는 등재하지 않는다", tool => {
    const homes = Object.entries(TOOL_CATEGORIES).filter(([, tools]) => tools.includes(tool))
    expect(homes.map(([c]) => c)).toEqual([])
  })

  it("impact_map은 별칭으로도 도달한다", async () => {
    expect(await discoverText("조문 영향")).toContain("impact_map")
  })
})

describe("별칭 안내는 1-hop 진입점 우선 (#110)", () => {
  it.each(["처분기준", "절차매뉴얼", "문서분석"])(
    "%s 카테고리는 legal_research를 먼저 제시한다",
    category => {
      expect(TOOL_CATEGORIES[category][0]).toBe("legal_research")
    }
  )

  it("'과태료 기준'은 legal_research를 chain_action_basis보다 먼저 안내", async () => {
    const text = await discoverText("과태료 기준")
    expect(text.indexOf("legal_research")).toBeGreaterThan(-1)
    expect(text.indexOf("legal_research")).toBeLessThan(text.indexOf("chain_action_basis"))
  })
})

describe("응답 중복 제거 (#109/#110 부수)", () => {
  // legal_research는 종합리서치·문서분석·처분기준·절차매뉴얼 4곳에 속한다.
  // 중복 제거가 없으면 600자 description이 한 응답에 4번 실린다.
  it("같은 도구가 두 번 이상 실리지 않는다", async () => {
    for (const intent of ["수수료", "판례", "법령", "해석례"]) {
      const text = await discoverText(intent)
      const listed = [...text.matchAll(/^ {2}- ([a-z0-9_]+):/gm)].map(m => m[1])
      expect(new Set(listed).size).toBe(listed.length)
    }
  })

  it("중복 제거로 비어버린 섹션 헤더는 남기지 않는다", async () => {
    const text = await discoverText("수수료")
    expect(text).not.toMatch(/^\[[^\]]+\]\n\n/m)
    expect(text).not.toContain("\n\n\n")
  })
})

describe("intent 정규화 (#111)", () => {
  // 회귀: intent를 trim하지 않아 앞뒤 공백이 description 매칭을 통째로 막았다.
  it("앞뒤 공백은 결과에 영향을 주지 않는다", async () => {
    expect(await discoverSections("  판례  ")).toEqual(await discoverSections("판례"))
    expect(await discoverSections("\t행정규칙\n")).toEqual(await discoverSections("행정규칙"))
  })
})

describe("지적 5 — 1-hop 앞세우기가 legal_analysis 계열에도 적용된다", () => {
  // #110 정책("별칭이 직접 겨냥하는 의도 카테고리는 1-hop 진입점을 앞세운다")이
  // legal_research 3곳에만 적용되고 legal_analysis 의 네 mode 카테고리에는 빠졌다.
  it.each([
    ["판례 유효성", "cite_check"],
    ["조문 영향", "impact_map"],
    ["당시 법령", "applicable_law"],
    ["환각 검증", "verify_citations"],
  ])("%s 는 legal_analysis 를 %s 보다 먼저 안내한다", async (intent, twoHop) => {
    const text = await discoverText(intent)
    expect(text).toContain("legal_analysis")
    expect(text.indexOf("legal_analysis")).toBeLessThan(text.indexOf(twoHop))
  })
})

describe("지적 5 — 말미 안내가 결과에 맞는다", () => {
  it("노출 도구만 돌려줬으면 execute_tool 로 유도하지 않는다", async () => {
    const text = await discoverText("조문 영향")
    expect(text).toContain("legal_analysis")
    expect(text).not.toMatch(/^execute_tool로 실행하세요\.$/m)
  })

  it("미노출 도구만 돌려줬으면 execute_tool 을 안내한다", async () => {
    const text = await discoverText("조세심판원")
    expect(text).toContain("execute_tool")
  })

  it("섞여 있으면 둘 다 말한다", async () => {
    const text = await discoverText("판례 유효성")
    expect(text).toContain("legal_analysis")
    expect(text).toContain("execute_tool")
  })
})
