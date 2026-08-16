/**
 * discover_tools 의 매칭·랭킹 — 어떤 intent 가 어떤 카테고리로 가고 무엇이 먼저 보이나.
 *
 * meta-tools 에서 갈라 놓은 기준은 줄 수가 아니라 결이다: 여기는 "어휘를 어떻게 맞추나",
 * meta-tools 는 "MCP 도구로 어떻게 내보내나". 실측 근거가 붙는 매칭 규칙은 전부 여기 모인다.
 */

import { TOOL_CATEGORIES, TOOL_ALIASES } from "./tool-profiles.js"

/** 한국어에는 낱말 사이 공백이 없으므로 "글자가 아닌 것"을 낱말 경계로 본다. */
const WORD_CHAR = /[\p{L}\p{N}_]/u

/** 매칭 강도 — 작을수록 먼저 보이고, 상한에 걸려도 살아남는다. */
const TIER_ALIAS_TOOL = 0
const TIER_ALIAS_CATEGORY = 1
const TIER_CATEGORY_NAME = 2
const TIER_DESCRIPTION = 3

/**
 * 한 응답에 실을 섹션 상한.
 *
 * 근거(실측, 1d27f73): 반드시 살아남아야 하는 케이스 30건 — 대표 intent 10개 +
 * 별칭 20건 — 의 정답 카테고리는 티어 랭킹에서 전부 1~2위에 온다. 상한 5는 그 2.5배
 * 여유이며 16개 intent 응답 합계를 50,483B → 16,471B(67%↓)로 줄인다.
 * 2까지 낮춰도 정답은 지켜지지만(80%↓) `법령`에서 법령연계·법체계 같은 유효한
 * 2차 카테고리까지 잘려 재현율 손실이 크다.
 */
export const MAX_SECTIONS = 5

export interface DiscoverySection {
  category: string
  tools: string[]
  tier: number
}

export interface Discovery {
  sections: DiscoverySection[]
  /** 상한에 걸려 잘린 카테고리 수 — 호출자는 이 수를 반드시 알려야 한다(무음 절단 금지). */
  omitted: number
}

/** 이름으로 도구를 찾는다. 없으면 undefined — 레지스트리 주입은 호출자 몫. */
export type ToolLookup = (name: string) => { description: string } | undefined

/**
 * 질의가 별칭을 **낱말 단위로** 포함하는지 (#106).
 *
 * 역방향(별칭 ⊃ 질의) 금지 — `판례`가 `조세심판례`에 흡수됐다. 정방향도 시작
 * 경계 필요 — `행정규칙`이 자치법규 별칭 `규칙`을 꼬리에 담아 오해석됐다.
 * 끝 경계는 요구하지 않는다: 한국어는 조사가 붙어 `조세심판원에`처럼 쓰인다.
 */
export function matchesAlias(query: string, alias: string): boolean {
  if (query === alias) return true
  for (let from = 0; ; ) {
    const at = query.indexOf(alias, from)
    if (at < 0) return false
    if (at === 0 || !WORD_CHAR.test(query[at - 1])) return true
    from = at + 1
  }
}

/**
 * 별칭 배열에 섞여 있는 도구명을 질의가 직접 가리키면 그 그룹의 도구들을 준다.
 *
 * 도구명 판정은 레지스트리 실재 여부로 한다 — 접두사 열거는 `cite_check`·
 * `applicable_law`를 놓쳤다 (#108). 영어 낱말 별칭(citator·treaty)은 레지스트리에
 * 없어 자연히 걸러진다.
 */
function aliasToolNames(query: string, isTool: (name: string) => boolean): string[] {
  for (const aliases of Object.values(TOOL_ALIASES)) {
    const names = aliases.filter(isTool)
    if (names.some(name => matchesAlias(query, name))) return names
  }
  return []
}

/** 질의에 걸리는 별칭 카테고리 전부 — 단일 승자면 나머지가 증발한다 (#126). */
function aliasCategories(query: string): Set<string> {
  return new Set(
    Object.entries(TOOL_ALIASES)
      .filter(([, aliases]) => aliases.some(alias => matchesAlias(query, alias.toLowerCase())))
      .map(([category]) => category)
  )
}

/**
 * 질의에 맞는 섹션을 강도순으로 고른다. query 는 소문자·trim 이 끝난 상태여야 한다.
 *
 * 같은 도구는 가장 강하게 매칭된 섹션에만 싣는다 — 통합 진입점(legal_research 등)은
 * 여러 카테고리에 속해 그대로 두면 한 응답에 최대 4번 실린다 (#109/#110).
 */
export function selectSections(query: string, tool: ToolLookup): Discovery {
  const found: DiscoverySection[] = []

  const aliasTools = aliasToolNames(query, name => tool(name) !== undefined)
  if (aliasTools.length > 0) {
    found.push({ category: `별칭 매칭 (${query})`, tools: aliasTools, tier: TIER_ALIAS_TOOL })
  }

  const byAlias = aliasCategories(query)
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (byAlias.has(category)) {
      found.push({ category, tools, tier: TIER_ALIAS_CATEGORY })
      continue
    }
    // 카테고리 직접 매칭은 별칭과 달리 양방향 부분일치를 유지한다 (#111).
    // 카테고리명은 한국어 합성명사라 역방향(카테고리 ⊃ 질의)이 곧 상위어 질의다:
    // `법령`→법령검색(수식어)과 `분석`→비교분석(핵심어)을 둘 다 살려야 한다.
    // 실측 — 낱말 경계를 걸면 대표 intent 10개 중 9개가 완전 동일하고 `분석`만
    // 5섹션 9도구→4섹션 5도구로 손실. 이득 0·손실 1이라 적용하지 않았다.
    if (category.includes(query) || query.includes(category)) {
      found.push({ category, tools, tier: TIER_CATEGORY_NAME })
      continue
    }
    // description 부분일치에도 낱말 경계를 걸지 마라 — `심판`이 조세심판·행정심판·
    // 권익위심판 3섹션에서 0섹션으로 전멸한다("조세심판원"·"행정심판례" 안에서 비경계).
    const matched = tools.filter(name => {
      const found = tool(name)
      return found !== undefined
        && (name.includes(query) || found.description.toLowerCase().includes(query))
    })
    if (matched.length > 0) found.push({ category, tools: matched, tier: TIER_DESCRIPTION })
  }

  // Array#sort 는 안정 정렬 — 같은 티어 안에서는 TOOL_CATEGORIES 삽입 순서가 유지된다.
  found.sort((a, b) => a.tier - b.tier)

  const claimed = new Set<string>()
  const unique: DiscoverySection[] = []
  for (const section of found) {
    const fresh = section.tools.filter(name => !claimed.has(name))
    fresh.forEach(name => claimed.add(name))
    if (fresh.length > 0) unique.push({ ...section, tools: fresh })
  }

  return {
    sections: unique.slice(0, MAX_SECTIONS),
    omitted: Math.max(0, unique.length - MAX_SECTIONS),
  }
}
