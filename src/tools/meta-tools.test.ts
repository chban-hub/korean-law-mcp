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
