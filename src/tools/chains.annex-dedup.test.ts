/**
 * 체인 별표 중복 제거 (#131 → provides 선언 구조)
 *
 * 시나리오가 이미 싣는 자원을 체인이 또 받으면 같은 파일을 두 번 내려받아 파싱하고
 * 같은 표가 두 번 나온다(실측 3.0초). 어느 시나리오가 무엇을 싣는지는 **시나리오가 선언**하고
 * 체인은 그 선언을 읽는다 — 체인 쪽에 시나리오 이름을 하드코딩하면 새 시나리오에서 재발한다.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { shouldFetchAnnexSeparately } from "./chains.js"
import { scenarioProvides } from "./scenarios/index.js"
import type { ScenarioName } from "../lib/scenario-rules.js"

const SCENARIO_DIR = join(process.cwd(), "src/tools/scenarios")

describe("#131 별표 중복 판정", () => {
  it("별표를 싣는 시나리오가 붙으면 체인은 별표를 따로 받지 않는다", () => {
    for (const s of ["penalty", "customs", "action_plan"] as ScenarioName[]) {
      expect([s, shouldFetchAnnexSeparately(["annex_fee"], s)]).toEqual([s, false])
      expect([s, shouldFetchAnnexSeparately(["annex_table"], s)]).toEqual([s, false])
    }
  })

  it("시나리오가 없으면 체인이 별표를 받는다", () => {
    expect(shouldFetchAnnexSeparately(["annex_fee"], null)).toBe(true)
    expect(shouldFetchAnnexSeparately(["annex_table"], null)).toBe(true)
  })

  it("별표를 싣지 않는 시나리오는 영향받지 않는다", () => {
    for (const s of ["timeline", "delegation", "impact", "manual", "compliance"] as ScenarioName[]) {
      expect([s, shouldFetchAnnexSeparately(["annex_fee"], s)]).toEqual([s, true])
    }
  })

  it("별표 확장 신호가 없으면 애초에 받지 않는다", () => {
    expect(shouldFetchAnnexSeparately([], null)).toBe(false)
    expect(shouldFetchAnnexSeparately(["precedent"], null)).toBe(false)
  })
})

describe("provides 선언이 실제 구현과 어긋나지 않는다", () => {
  it("별표를 조회하는 시나리오 모듈은 전부 annex 를 선언한다", () => {
    // 선언을 빠뜨린 새 시나리오가 중복 조회를 되살리는 것을 막는 드리프트 가드
    const files = readdirSync(SCENARIO_DIR)
      .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts") && !["index.ts", "types.ts"].includes(f))
    const undeclared: string[] = []
    for (const f of files) {
      const src = readFileSync(join(SCENARIO_DIR, f), "utf8")
      if (!/\bgetAnnexes\b/.test(src)) continue
      const name = f.replace(/\.ts$/, "").replace(/-/g, "_") as ScenarioName
      if (!scenarioProvides(name).includes("annex")) undeclared.push(f)
    }
    expect(undeclared).toEqual([])
  })
})
