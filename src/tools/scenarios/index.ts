/**
 * Scenario 통합 실행기
 * 시나리오 타입에 따라 적절한 모듈을 호출하고 결과를 반환
 */
export type { ScenarioType, ScenarioResult, ScenarioContext } from "./types.js"
export { formatSections, formatSuggestedActions } from "./types.js"

import type { ScenarioType, ScenarioContext, ScenarioResult } from "./types.js"
import { detectScenarioName } from "../../lib/scenario-rules.js"
import { runPenaltyScenario } from "./penalty.js"
import { runCustomsScenario } from "./customs.js"
import { runManualScenario } from "./manual.js"
import { runDelegationScenario } from "./delegation.js"
import { runImpactScenario } from "./impact.js"
import { runTimelineScenario } from "./timeline.js"
import { runComplianceScenario } from "./compliance.js"
import { runTimeTravelScenario } from "./time-travel.js"
import { runActionPlanScenario } from "./action-plan.js"

const SCENARIO_RUNNERS: Record<ScenarioType, (ctx: ScenarioContext) => Promise<ScenarioResult>> = {
  penalty: runPenaltyScenario,
  customs: runCustomsScenario,
  manual: runManualScenario,
  delegation: runDelegationScenario,
  impact: runImpactScenario,
  timeline: runTimelineScenario,
  compliance: runComplianceScenario,
  time_travel: runTimeTravelScenario,
  action_plan: runActionPlanScenario,
}

/** 시나리오 실행 — 알 수 없는 타입이면 빈 결과 반환 */
export async function runScenario(
  type: ScenarioType,
  ctx: ScenarioContext
): Promise<ScenarioResult> {
  const runner = SCENARIO_RUNNERS[type]
  if (!runner) {
    return { sections: [], suggestedActions: [] }
  }
  try {
    return await runner(ctx)
  } catch (e) {
    // 시나리오 실패는 체인 전체를 중단시키지 않되, 무음 증발 금지 —
    // 실패 섹션을 반환해 LLM이 "결과 없음"과 "실행 실패"를 구분하게 한다 (secOrSkip과 동일 원칙)
    const msg = e instanceof Error ? e.message : String(e)
    return {
      sections: [{
        title: `시나리오(${type}) [FAILED]`,
        content: `⚠️ 시나리오 실행 실패 — LLM은 이 섹션 내용을 추측/생성하지 마세요.\n사유: ${msg.slice(0, 200)}`,
        isError: true,
      }],
      suggestedActions: [],
    }
  }
}

/**
 * 쿼리에서 시나리오 타입 추론 (MCP 직접호출 경로).
 *
 * 판정 어휘·우선순위는 lib/scenario-rules.ts 하나에만 있다 — CLI(query-router)도 같은 함수를 본다.
 * 규칙이 두 벌이던 시절엔 같은 쿼리가 표면에 따라 다른 시나리오로 갔다(#101).
 */
export function detectScenario(query: string, hostChain: string): ScenarioType | null {
  return detectScenarioName(query, hostChain)
}
