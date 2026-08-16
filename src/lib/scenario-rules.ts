/**
 * 시나리오 감지 규칙 — 단일 원본 (#101)
 *
 * 판정은 두 표면에서 일어난다 — CLI(query-router 가 params.scenario 를 붙임)와
 * MCP(chain_* 가 detectScenario 로 스스로 판정). 규칙이 두 벌이면 같은 쿼리가 표면에 따라
 * 다른 시나리오로 간다(2026-08-16 실측, divergence 10건). 그래서 **판정 어휘와 우선순위는
 * 이 파일에만 존재한다** — 두 표면 모두 여기서 읽는다.
 *
 * precedence: 낮을수록 우선, 같은 hostChain 안에서만 경쟁. 라우터의 기존 순서
 * (구체 상황 > 구획 주제)를 단일 기준으로 채택 → action_plan(7) 이 customs(13) 보다 앞선다.
 * "관세 환급을 못 받았어" 가 관세 구획에 먹히던 문제(BUG-R4)의 수정.
 */

import { RELATIVE_NOW_WORDS, RELATIVE_PAST_WORDS } from "./date-patterns.js"

/** 지원 시나리오 (tools/scenarios/types.ts 의 ScenarioType 원본) */
export type ScenarioName =
  | "penalty" | "customs" | "manual" | "delegation" | "impact"
  | "timeline" | "compliance" | "time_travel" | "action_plan"

export interface ScenarioRule {
  scenario: ScenarioName
  /** 이 시나리오를 실을 수 있는 체인 도구 */
  hostChain: string
  /** 낮을수록 우선 — CLI·MCP 공통 */
  precedence: number
  /** 시나리오 판정 어휘 (OR) */
  patterns: RegExp[]
  /**
   * 라우터가 "이 신호만 보고 hostChain 을 고를" 때 쓰는 트리거. null = 도구 선택에는 쓰지 않는다
   * (다른 패턴이 체인을 고른 뒤 라벨만 붙는다). patterns 보다 좁을 수 있다 — 판정 어휘를 그대로
   * 도구 선택에 쓰면 "관세"·"과태료" 같은 넓은 구획어가 절차·쟁송 라우팅을 가로챈다.
   */
  routeTriggers: RegExp[] | null
}

/** 시민 상황 서술 — 구체 사건이 이미 벌어졌거나 돈을 못 받고 있는 상태 */
const ACTION_PLAN_SITUATION = [
  // 어간까지만 잡아 경어체·연결어미를 함께 흡수한다 (받았습니다/걸렸는데/당했어요)
  /받았|걸렸|당했/,
  // 완곡·부정 표현: 못 받/돌려받지 못/안 줘
  /못\s*(?:돌려)?받|받지\s*못|못\s*(?:주|줘|준)/,
  /안\s*(?:줘|주고|준대|줍니다|돌려\s*[주줘])/,
  /돼\?/,
  // "되나"는 일반 가부 질의에 널리 쓰여 단독으로는 오탐이다(BUG-R5) — 문맥을 요구한다.
  // 허용을 구하는 어미(-아도/-어도/-해도)와 "어떻게 되나"만 시민 상황으로 본다.
  // ("손금 산입이 되나", "유효하게 되나" 같은 계사 용법은 제외)
  /어떻게\s*되나|(?:아|어|여|애|해|하여|가|와|봐|써|돼)도\s*되나/,
]

/** 절차 안내 요구 — 상황 서술 없이 "무엇을 해야 하나"만 묻는 형태 */
const ACTION_PLAN_GUIDANCE = [
  /어떻게\s*해야|뭘\s*해야|뭐\s*해야/,
  /실행\s*가이드|시민\s*가이드|단계\s*별|단계별|step\s*by\s*step|action\s*plan/i,
]

/** 두 시점이 명시된 형태 — "2024 vs 2026", "2024년과 2025년", "2020년부터 2023년까지" */
const TIME_TRAVEL_TWO_POINTS = /(\d{4})\s*[.\-년]?\s*(?:vs\.?|↔|~|와|과|부터|에서)\s*(?:\d{4}|현행|지금|현재)/i
/** 상대 시점 두 개 — "작년이랑 지금". 어휘는 date-patterns 한 벌만 쓴다(#144) */
const TIME_TRAVEL_RELATIVE = new RegExp(
  `(?:${RELATIVE_PAST_WORDS})\\s*(?:이?랑|와|과|하고|대비)\\s*(?:${RELATIVE_NOW_WORDS})`
)
const TIME_TRAVEL_EXPLICIT = /시점\s*비교|버전\s*비교|두\s*시점|time\s*travel/i
/** 연·월 + 연결어미 — 두 번째 시점이 불분명해 도구 선택 근거로는 약하다(라벨 전용) */
const TIME_TRAVEL_LOOSE = /\d{4}\s*[.\-년]\s*\d{1,2}.*(?:vs|와|과|↔|~|부터|에서)/i

// 아래 네 구획은 routeTriggers 가 patterns 의 "좁힘"이다.
// 어휘를 두 번 적으면 그 자리에서 갈라지므로(이 파일이 없애려던 바로 그 실패) 원본 문자열에서 조립한다.

const DELEGATION_TOKENS = /위임\s*입법|미이행|미제정|위임\s*현황|하위\s*법령\s*제정/

/** 영향도 핵심어. 라벨은 여기에 넓은 `파급`을, 라우팅은 `파급 효과`만 더한다 */
const IMPACT_CORE = "영향\\s*도|영향\\s*분석|연쇄\\s*개정"
const IMPACT_LABEL = new RegExp(`${IMPACT_CORE}|파급|하위\\s*법령\\s*영향`)
const IMPACT_ROUTE = new RegExp(`${IMPACT_CORE}|파급\\s*효과`)

/** 관세 구획 핵심어 — 단독으로는 도구를 고르지 않는다(절차·쟁송 라우팅을 가로챈다) */
const CUSTOMS_AREA = "관세|수입|수출|통관"
const CUSTOMS_LABEL = new RegExp(`${CUSTOMS_AREA}|FTA|원산지|HS\\s*코드|품목\\s*분류|관세사`, "i")
const CUSTOMS_ROUTE = [
  new RegExp(`(?:${CUSTOMS_AREA}).*(?:법|절차|기준|체크|확인|검토)`),
  /FTA.*(?:적용|원산지|세율|협정)/,
  /HS\s*코드|품목\s*분류/i,
]

/** 처분·벌칙 행위어. '처벌'은 대표 예시("음주운전 처벌 기준") 어휘인데 양쪽 모두 빠져 있었다(BUG-R6) */
const PENALTY_ACTION = "과태료|벌칙|벌금|처벌|과징금|영업\\s*정지|행정\\s*처분"
const PENALTY_LABEL = new RegExp(`${PENALTY_ACTION}|처분\\s*기준|감경|이행\\s*강제금`)
const PENALTY_ROUTE = [
  new RegExp(`(?:${PENALTY_ACTION}).*(?:기준|금액|감경|얼마)`),
  /(?:위반|적발).*(?:처분|벌금|과태료|처벌)/,
]

/** 선언 순서 = 같은 precedence·같은 host 안에서의 판정 순서 (위임 → 영향) */
const DECLARED_RULES: ScenarioRule[] = [
  {
    scenario: "time_travel",
    hostChain: "chain_amendment_track",
    precedence: 3,
    patterns: [TIME_TRAVEL_TWO_POINTS, TIME_TRAVEL_LOOSE, TIME_TRAVEL_RELATIVE, TIME_TRAVEL_EXPLICIT],
    routeTriggers: [TIME_TRAVEL_TWO_POINTS, TIME_TRAVEL_RELATIVE, TIME_TRAVEL_EXPLICIT],
  },
  {
    scenario: "action_plan",
    hostChain: "chain_full_research",
    precedence: 7,
    patterns: ACTION_PLAN_SITUATION,
    routeTriggers: ACTION_PLAN_SITUATION,
  },
  {
    scenario: "delegation",
    hostChain: "chain_law_system",
    precedence: 9,
    patterns: [DELEGATION_TOKENS],
    routeTriggers: [DELEGATION_TOKENS],
  },
  {
    scenario: "impact",
    hostChain: "chain_law_system",
    // delegation 과 같은 순번 — 같은 host 안에서는 선언 순서(위임 → 영향)가 유지된다
    precedence: 9,
    patterns: [IMPACT_LABEL],
    routeTriggers: [IMPACT_ROUTE],
  },
  {
    scenario: "timeline",
    hostChain: "chain_amendment_track",
    precedence: 11,
    patterns: [/시계열|타임라인|판례\s*변화|해석\s*변화|적용\s*시점|소급/],
    routeTriggers: null,
  },
  {
    scenario: "customs",
    hostChain: "chain_full_research",
    precedence: 13,
    patterns: [CUSTOMS_LABEL],
    // 판정 어휘를 그대로 쓰면 "관세 불복 소송"까지 종합리서치로 끌어간다 — 구획어 + 실무 의도로 좁힌다
    routeTriggers: CUSTOMS_ROUTE,
  },
  {
    scenario: "penalty",
    hostChain: "chain_action_basis",
    precedence: 13,
    patterns: [PENALTY_LABEL],
    routeTriggers: PENALTY_ROUTE,
  },
  {
    scenario: "action_plan",
    hostChain: "chain_full_research",
    // 상황 서술 없는 "어떻게 해야"는 구획 주제(관세 등)보다 뒤 — 절차 라우팅(14)보다는 앞
    precedence: 13.5,
    patterns: ACTION_PLAN_GUIDANCE,
    routeTriggers: ACTION_PLAN_GUIDANCE,
  },
  {
    scenario: "manual",
    hostChain: "chain_procedure_detail",
    precedence: 15,
    patterns: [/처리\s*방법|처리\s*절차|업무\s*매뉴얼|담당|민원|공무원|처리\s*기한/],
    routeTriggers: null,
  },
  {
    scenario: "compliance",
    hostChain: "chain_ordinance_compare",
    // host 안 유일 규칙이라 값은 라우터 우선순위로만 쓰인다. ordinance(5)보다 앞서야
    // "서울시 조례가 상위법에 저촉되나"가 단순 조례 검색에 먹히지 않는다(#122)
    precedence: 4,
    patterns: [/적합성|상위법\s*위반|위법|초과|저촉|법제\s*심사/],
    // 판정 어휘(위법·초과 등)는 너무 넓어 그대로 쓰면 모든 질의를 조례비교로 끌어간다
    routeTriggers: [
      /(?:조례|자치법규)[^]{0,20}?(?:상위법|저촉|적합성|법제\s*심사)/,
      /(?:상위법|저촉|적합성|법제\s*심사)[^]{0,20}?(?:조례|자치법규)/,
    ],
  },
]

/** precedence 순 (동순위는 선언 순서 유지 — Array.sort 는 안정 정렬) */
const SCENARIO_RULES: ScenarioRule[] =
  [...DECLARED_RULES].sort((a, b) => a.precedence - b.precedence)

/** 라우터가 도구 선택에 쓸 수 있는 규칙만 (precedence 순) */
export const ROUTABLE_SCENARIO_RULES: ScenarioRule[] =
  SCENARIO_RULES.filter(r => r.routeTriggers !== null)

/**
 * 시나리오를 실을 수 있는 체인 도구 이름 (중복 제거).
 * hostChain 은 문자열이라 오타가 나도 컴파일된다 — 실재 도구인지는 테스트가 지킨다.
 */
/** 테스트 도달용 공개 — 프로덕션 소비자는 이 파일 안뿐이다 (#143) */
export const SCENARIO_HOST_CHAINS: string[] =
  [...new Set(SCENARIO_RULES.map(r => r.hostChain))]

/**
 * 쿼리 + 호스트 체인 → 시나리오. CLI·MCP 공통 진입점.
 * 같은 (query, hostChain) 에는 언제나 같은 답을 준다 — 표면별 분기 없음.
 */
export function detectScenarioName(query: string, hostChain: string): ScenarioName | null {
  for (const rule of SCENARIO_RULES) {
    if (rule.hostChain !== hostChain) continue
    if (rule.patterns.some(p => p.test(query))) return rule.scenario
  }
  return null
}
