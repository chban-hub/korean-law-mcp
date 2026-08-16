/**
 * Meta Tools — lite 프로필에서 전체 도구 접근을 위한 디스커버리/실행 도구
 *
 * discover_tools: 의도/카테고리로 사용 가능한 도구 목록 반환
 * execute_tool:   discover로 찾은 도구를 프록시 실행
 */

import { z } from "zod"
import { TOOL_CATEGORIES, TOOL_ALIASES, describeCallPath } from "../lib/tool-profiles.js"
import { formatToolError } from "../lib/errors.js"
import { truncateResponse } from "../lib/schemas.js"
import type { LawApiClient } from "../lib/api-client.js"
import type { McpTool, ToolResponse } from "../lib/types.js"

// allTools 참조 (순환참조 방지를 위해 런타임 주입).
// 이름 색인으로 들고 있는다 — 도구명 조회가 이 모듈의 유일한 사용처다.
let _toolIndex = new Map<string, McpTool>()
export function setAllToolsRef(tools: McpTool[]) {
  _toolIndex = new Map(tools.map(tool => [tool.name, tool]))
}

// ========================================
// discover_tools
// ========================================

export const DiscoverToolsSchema = z.object({
  intent: z.string().describe("찾고 싶은 도구의 의도 또는 카테고리 (예: '공정위', '조약', '용어', '헌재')"),
})

/** 한국어에는 낱말 사이 공백이 없으므로 "글자가 아닌 것"을 낱말 경계로 본다. */
const WORD_CHAR = /[\p{L}\p{N}_]/u

/**
 * 질의가 별칭을 **낱말 단위로** 포함하는지 (#106).
 *
 * 역방향(별칭 ⊃ 질의) 금지 — `판례`가 `조세심판례`에 흡수됐다. 정방향도 시작
 * 경계 필요 — `행정규칙`이 자치법규 별칭 `규칙`을 꼬리에 담아 오해석됐다.
 * 끝 경계는 요구하지 않는다: 한국어는 조사가 붙어 `조세심판원에`처럼 쓰인다.
 */
function matchesAlias(query: string, alias: string): boolean {
  if (query === alias) return true
  for (let from = 0; ; ) {
    const at = query.indexOf(alias, from)
    if (at < 0) return false
    if (at === 0 || !WORD_CHAR.test(query[at - 1])) return true
    from = at + 1
  }
}

/**
 * 별칭/자연어 입력을 카테고리명으로 해석.
 * TOOL_ALIASES에서 매칭되는 경우 해당 카테고리 키 반환, 없으면 undefined.
 */
function resolveAliasToCategory(query: string): string | undefined {
  const q = query.toLowerCase().trim()
  for (const [category, aliases] of Object.entries(TOOL_ALIASES)) {
    if (aliases.some(alias => matchesAlias(q, alias.toLowerCase()))) {
      return category
    }
  }
  return undefined
}

/**
 * 별칭 배열에 섞여 있는 도구명을 질의가 직접 가리키는지 확인.
 *
 * 도구명 판정은 레지스트리 실재 여부로 한다 — 접두사 열거는 `cite_check`·
 * `applicable_law`를 놓쳤다 (#108). 영어 낱말 별칭(citator·treaty)은 레지스트리에
 * 없어 자연히 걸러진다.
 */
function resolveAliasToTools(query: string): string[] | undefined {
  const q = query.toLowerCase().trim()
  for (const aliases of Object.values(TOOL_ALIASES)) {
    const toolNames = aliases.filter(alias => _toolIndex.has(alias))
    if (toolNames.some(name => matchesAlias(q, name))) {
      return toolNames
    }
  }
  return undefined
}

export async function discoverTools(
  _apiClient: LawApiClient,
  input: z.infer<typeof DiscoverToolsSchema>
): Promise<ToolResponse> {
  // trim은 정규화 초입에서 한 번만 — 안 하면 앞뒤 공백이 description 매칭을
  // 통째로 막아 `"  판례  "`가 `"판례"`보다 적은 결과를 냈다 (#111).
  const query = input.intent.toLowerCase().trim()
  const matches: Array<{ category: string; tools: string[] }> = []

  // 1단계: 별칭 → 카테고리 해석
  const aliasCategory = resolveAliasToCategory(query)

  // 2단계: 별칭 → 특정 도구 매칭
  const aliasTools = resolveAliasToTools(query)
  if (aliasTools && aliasTools.length > 0) {
    matches.push({ category: `별칭 매칭 (${input.intent})`, tools: aliasTools })
  }

  for (const [category, toolNames] of Object.entries(TOOL_CATEGORIES)) {
    // 별칭으로 해석된 카테고리는 무조건 포함
    if (aliasCategory === category) {
      matches.push({ category, tools: toolNames })
      continue
    }
    // 카테고리 직접 매칭은 별칭과 달리 양방향 부분일치를 유지한다 (#111).
    // 카테고리명은 한국어 합성명사라 역방향(카테고리 ⊃ 질의)이 곧 상위어 질의다:
    // `법령`→법령검색(수식어)과 `분석`→비교분석(핵심어)을 둘 다 살려야 한다.
    // 실측 — 낱말 경계를 걸면 대표 intent 10개 중 9개가 완전 동일(`법령` 21섹션
    // 50도구 불변, 탈락한 영문법령은 아래 description 경로가 복구)이고 `분석`만
    // 5섹션 9도구→4섹션 5도구로 손실. 이득 0·손실 1이라 적용하지 않았다.
    if (category.includes(query) || query.includes(category)) {
      matches.push({ category, tools: toolNames })
      continue
    }
    // 도구 이름/설명에서도 매칭
    const matchedTools = toolNames.filter(name => {
      const tool = _toolIndex.get(name)
      if (!tool) return false
      return name.includes(query) || tool.description.toLowerCase().includes(query)
    })
    if (matchedTools.length > 0) {
      matches.push({ category, tools: matchedTools })
    }
  }

  if (matches.length === 0) {
    // 전체 카테고리 목록 반환
    const categoryList = Object.entries(TOOL_CATEGORIES)
      .map(([cat, tools]) => `• ${cat}: ${tools.length}개 도구`)
      .join("\n")
    return {
      content: [{ type: "text", text: `"${input.intent}"에 해당하는 도구를 찾지 못했습니다.\n\n사용 가능한 카테고리:\n${categoryList}\n\n카테고리명으로 다시 검색해주세요.` }]
    }
  }

  // 통합 진입점(legal_research 등)은 여러 카테고리에 속해, 그대로 두면 600자짜리
  // description이 한 응답에 최대 4번 실린다 — 처음 나온 섹션에만 싣는다 (#109/#110).
  const seen = new Set<string>()
  const sections = matches.map(m => {
    const fresh = m.tools.filter(name => !seen.has(name))
    fresh.forEach(name => seen.add(name))
    if (fresh.length === 0) return ""
    const toolDetails = fresh.map(name => {
      const tool = _toolIndex.get(name)
      return `  - ${name}: ${tool?.description || "(설명 없음)"}`
    }).join("\n")
    return `[${m.category}]\n${toolDetails}`
  }).filter(section => section !== "").join("\n\n")

  return {
    content: [{ type: "text", text: truncateResponse(`"${input.intent}" 관련 도구:\n\n${sections}\n\n${describeCallPath(seen)}`) }]
  }
}

// ========================================
// execute_tool
// ========================================

export const ExecuteToolSchema = z.object({
  tool_name: z.string().describe("실행할 도구 이름 (discover_tools로 확인한 이름)"),
  params: z.record(z.string(), z.unknown()).describe("도구에 전달할 파라미터 객체"),
})

const META_TOOL_NAMES = new Set(["discover_tools", "execute_tool"])

export async function executeTool(
  apiClient: LawApiClient,
  input: z.infer<typeof ExecuteToolSchema>
): Promise<ToolResponse> {
  // 메타 도구 자기 자신 재귀 호출 방지
  if (META_TOOL_NAMES.has(input.tool_name)) {
    return {
      content: [{ type: "text", text: `메타 도구(${input.tool_name})는 execute_tool로 실행할 수 없습니다.` }],
      isError: true
    }
  }

  const tool = _toolIndex.get(input.tool_name)
  if (!tool) {
    return {
      content: [{ type: "text", text: `도구를 찾을 수 없습니다: ${input.tool_name}\ndiscover_tools로 사용 가능한 도구를 먼저 확인하세요.` }],
      isError: true
    }
  }

  try {
    const parsed = tool.schema.parse(input.params)
    return await tool.handler(apiClient, parsed) as ToolResponse
  } catch (error) {
    return formatToolError(error as Error, input.tool_name)
  }
}
