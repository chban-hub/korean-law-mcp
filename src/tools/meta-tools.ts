/**
 * Meta Tools — lite 프로필에서 전체 도구 접근을 위한 디스커버리/실행 도구
 *
 * discover_tools: 의도/카테고리로 사용 가능한 도구 목록 반환
 * execute_tool:   discover로 찾은 도구를 프록시 실행
 *
 * 어떤 intent 가 어떤 카테고리로 가는지는 lib/tool-discovery 가 정한다 —
 * 여기는 그 결과를 어떻게 보여주고 어떻게 실행하느냐만 본다.
 */

import { z } from "zod"
import { MAX_CHAIN_QUERY } from "./chains.js"
import { TOOL_CATEGORIES, V3_EXPOSED, describeCallPath } from "../lib/tool-profiles.js"
import { selectSections, suggestCategories, browsableCategories } from "../lib/tool-discovery.js"
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
  // 상한은 체인 query(#121)와 같은 값 — 무제한 텍스트가 별칭·설명 매칭 루프에 그대로 들어간다(#150)
  intent: z.string().max(MAX_CHAIN_QUERY)
    .describe("찾고 싶은 도구의 의도 또는 카테고리 (예: '공정위', '조약', '용어', '헌재')"),
})

/**
 * 도구 한 줄.
 *
 * 노출 도구(V3_EXPOSED)의 description 은 ListTools 로 이미 클라이언트 컨텍스트에
 * 들어가 있다 — 여기서 다시 실으면 순수 중복이다. 게다가 legal_research(640자)·
 * legal_analysis(480자)는 거의 모든 법률 어휘를 담고 있어 어지간한 intent 의
 * description 매칭에 다 걸린다. 이름과 호출 방식만 알린다 (#126).
 */
function toolLine(name: string): string {
  if (V3_EXPOSED.has(name)) return `  - ${name}: 노출 도구 — 직접 호출 (설명은 도구 목록 참조)`
  return `  - ${name}: ${_toolIndex.get(name)?.description || "(설명 없음)"}`
}

export async function discoverTools(
  _apiClient: LawApiClient,
  input: z.infer<typeof DiscoverToolsSchema>
): Promise<ToolResponse> {
  // trim은 정규화 초입에서 한 번만 — 안 하면 앞뒤 공백이 description 매칭을
  // 통째로 막아 `"  판례  "`가 `"판례"`보다 적은 결과를 냈다 (#111).
  const query = input.intent.toLowerCase().trim()
  const { sections, omitted } = selectSections(query, name => _toolIndex.get(name))

  if (sections.length === 0) {
    // 카테고리를 통째로 나열해 봐야 소비자는 그중 무엇이 자기 질의에 가까운지
    // 모른다 — 표면이 가까운 것만 짚고 넓혀 볼 방향 한 줄을 준다 (#126).
    const near = suggestCategories(query)
    const nearLine = near.length > 0 ? `\n가까운 카테고리: ${near.join(", ")}` : ""
    const anchors = browsableCategories().join("·")
    const total = Object.keys(TOOL_CATEGORIES).length
    return {
      content: [{ type: "text", text: `"${input.intent}"에 해당하는 도구를 찾지 못했습니다.${nearLine}\n카테고리 ${total}개 — ${anchors} 같은 넓은 말이나 도구 이름으로 다시 시도하세요.` }]
    }
  }

  const listed = new Set<string>()
  const body = sections.map(section => {
    section.tools.forEach(name => listed.add(name))
    return `[${section.category}]\n${section.tools.map(toolLine).join("\n")}`
  }).join("\n\n")
  // 잘린 게 있으면 반드시 말한다 — 조용히 자르면 소비자는 그게 전부인 줄 안다.
  // "연관도 낮은"이라고 말하지 않는다 — 연관도 계산은 없고 티어·coverage 순 절단이다(#150).
  const cut = omitted > 0
    ? `\n\n(그 외 ${omitted}개 카테고리 생략 — intent를 좁히면 나머지가 보입니다.)`
    : ""

  return {
    content: [{ type: "text", text: truncateResponse(`"${input.intent}" 관련 도구:\n\n${body}${cut}\n\n${describeCallPath(listed)}`) }]
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
