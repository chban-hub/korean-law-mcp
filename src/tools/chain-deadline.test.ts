/**
 * 체인 데드라인 + 부분 결과 (#131 완결)
 *
 * 병렬화로는 업스트림 꼬리를 못 막는다 — 같은 질의가 12초로도, 71초로도 끝난다(실측).
 * 60초 클라이언트 한도를 넘기면 이용자는 **아무것도** 못 받는다. 시간이 다하면
 * 받은 것까지라도 조립하고, 못 받은 자리는 침묵이 아니라 마커로 남긴다.
 *
 * 지연은 전부 mock 이다 — 실제 업스트림을 기다리지 않는다.
 */
import { describe, it, expect } from "vitest"
import {
  DEFAULT_CHAIN_DEADLINE_MS,
  resolveChainDeadlineMs,
  startChainDeadline,
  raceDeadline,
  timedOutSection,
} from "./chain-deadline.js"

/** 절대 스스로 끝나지 않는 갈래 — 데드라인이 끊어 줘야 한다 */
const never = <T>(): Promise<T> => new Promise<T>(() => {})
const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms))

describe("데드라인 값", () => {
  it("기본값은 클라이언트 한도(60초)보다 넉넉히 짧다", () => {
    expect(DEFAULT_CHAIN_DEADLINE_MS).toBeLessThanOrEqual(45_000)
    expect(DEFAULT_CHAIN_DEADLINE_MS).toBeGreaterThan(10_000)
  })

  it("환경변수로 조정된다", () => {
    expect(resolveChainDeadlineMs({ MCP_CHAIN_DEADLINE_MS: "20000" })).toBe(20_000)
    expect(resolveChainDeadlineMs({})).toBe(DEFAULT_CHAIN_DEADLINE_MS)
  })

  it("정수 아닌 값·범위 밖 값은 거부한다", () => {
    expect(() => resolveChainDeadlineMs({ MCP_CHAIN_DEADLINE_MS: "20x" })).toThrow()
    expect(() => resolveChainDeadlineMs({ MCP_CHAIN_DEADLINE_MS: "-1" })).toThrow()
    expect(() => resolveChainDeadlineMs({ MCP_CHAIN_DEADLINE_MS: "1" })).toThrow()
    expect(() => resolveChainDeadlineMs({ MCP_CHAIN_DEADLINE_MS: "999999999" })).toThrow()
  })
})

describe("부분 결과 조립", () => {
  it("시간 안에 끝난 갈래는 값을 유지하고 못 끝낸 갈래만 표시된다", async () => {
    const d = startChainDeadline(60)
    try {
      const [fast, slow] = await Promise.all([
        raceDeadline(d, after(5, "완료된 섹션")),
        raceDeadline(d, never<string>()),
      ])
      expect(fast).toEqual({ ok: true, value: "완료된 섹션" })
      expect(slow.ok).toBe(false)
    } finally {
      d.dispose()
    }
  })

  it("데드라인이 지나면 진행 중 요청을 취소한다 — 소켓을 남기지 않는다", async () => {
    const d = startChainDeadline(30)
    try {
      expect(d.signal.aborted).toBe(false)
      await raceDeadline(d, never<string>())
      expect(d.signal.aborted).toBe(true)
      expect(d.expired()).toBe(true)
    } finally {
      d.dispose()
    }
  })

  it("갈래가 데드라인 전에 실패하면 그 실패는 삼키지 않는다", async () => {
    const d = startChainDeadline(5_000)
    try {
      await expect(raceDeadline(d, Promise.reject(new Error("업스트림 파싱 실패"))))
        .rejects.toThrow("업스트림 파싱 실패")
    } finally {
      d.dispose()
    }
  })

  it("데드라인 후의 실패는 시간 초과로 처리한다", async () => {
    const d = startChainDeadline(20)
    try {
      const work = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("aborted")), 60))
      expect((await raceDeadline(d, work)).ok).toBe(false)
    } finally {
      d.dispose()
    }
  })
})

describe("미완 섹션 마커", () => {
  it("침묵 대신 무엇을 못 받았고 어떻게 받는지 알려준다", () => {
    const s = timedOutSection("관련 판례", "search_precedents")
    expect(s).toContain("관련 판례")
    expect(s).toContain("시간 한도")
    expect(s).toContain("search_precedents")
  })
})
