import { afterEach, describe, it, expect, vi } from "vitest"
import { followLawAntibot, parseAntibotUrl } from "./law-antibot.js"
import { requestContext } from "./session-state.js"
import { DEFAULT_EXECUTION_LIMITS, RequestExecutionBudget } from "./execution-limits.js"

afterEach(() => vi.unstubAllGlobals())

describe("parseAntibotUrl", () => {
  it("패턴 A(concat) — t+h+o 조합으로 리다이렉트 경로 복원", () => {
    const html = `<script>var x={t:'/DRF',h:'/lawService.do',o:'?OC=test&target=law'};location.assign(x.t+x.h+x.o);</script>`
    expect(parseAntibotUrl(html)).toBe("/DRF/lawService.do?OC=test&target=law")
  })

  it("패턴 B(substr) — o.substr 슬라이싱으로 삽입문자 제거", () => {
    // o="/DRF/XXlawService.do", c=5, z=2 → slice(0,5)+slice(7) = "/DRF/" + "lawService.do"
    const html = `<script>var x={o:'/DRF/XXlawService.do',c:5},z=2;location.assign(o.substr(0,c)+o.substr(c+z));</script>`
    expect(parseAntibotUrl(html)).toBe("/DRF/lawService.do")
  })

  it("안티봇 패턴이 없으면 null", () => {
    expect(parseAntibotUrl("<html><body>정상 응답</body></html>")).toBeNull()
    expect(parseAntibotUrl("")).toBeNull()
  })

  it("releases a redirect response only after its replacement succeeds", async () => {
    const original = new Response(
      `<script>var x={t:'/DRF',h:'/next',o:'?token=1'};location.assign(x.t+x.h+x.o);</script>`,
    )
    const replacement = new Response("replacement")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(replacement))

    await expect(followLawAntibot(
      original,
      "https://www.law.go.kr/DRF/original",
      new Headers(),
      1_000,
    )).resolves.toBe(replacement)
    expect(original.bodyUsed).toBe(true)
  })

  it("preserves the original response when the replacement request fails", async () => {
    const original = new Response(
      `<script>var x={t:'/DRF',h:'/next',o:'?token=1'};location.assign(x.t+x.h+x.o);</script>`,
    )
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failed")))

    await expect(followLawAntibot(
      original,
      "https://www.law.go.kr/DRF/original",
      new Headers(),
      1_000,
    )).rejects.toThrow("network failed")
    expect(original.bodyUsed).toBe(false)
  })

  it("preserves the root response when the 404 fallback fetch fails", async () => {
    const original = new Response(
      `<script>var x={t:'/DRF',h:'/next',o:'?token=1'};location.assign(x.t+x.h+x.o);</script>`,
    )
    const notFound = new Response("missing", { status: 404 })
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(notFound)
      .mockRejectedValueOnce(new Error("fallback failed")))

    await expect(followLawAntibot(
      original,
      "https://www.law.go.kr/DRF/original",
      new Headers(),
      1_000,
    )).rejects.toThrow("fallback failed")
    expect(original.bodyUsed).toBe(false)
    expect(notFound.bodyUsed).toBe(true)
  })

  it("preserves the root response when a later anti-bot hop fails", async () => {
    const redirect = `<script>var x={t:'/DRF',h:'/next',o:'?token=1'};location.assign(x.t+x.h+x.o);</script>`
    const original = new Response(redirect)
    const intermediate = new Response(redirect)
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(intermediate)
      .mockRejectedValueOnce(new Error("later hop failed")))

    await expect(followLawAntibot(
      original,
      "https://www.law.go.kr/DRF/original",
      new Headers(),
      1_000,
    )).rejects.toThrow("later hop failed")
    expect(original.bodyUsed).toBe(false)
    expect(intermediate.bodyUsed).toBe(true)
  })

  // #150-5: 안티봇 검사가 clone 전체 본문을 읽으면 law.go.kr의 **모든** 성공 응답이
  // 예산에 이중 청구된다 — 검사 자체가 정상 대형 응답을 예산 초과로 죽이기까지 한다.
  // 판정 마커(location.assign)는 실측·픽스처 전부 첫 ~130바이트 안에 온다.
  it("안티봇 검사는 프리픽스만 훔쳐보고 본문을 예산에 청구하지 않는다", async () => {
    const body = `<?xml version="1.0"?><LawSearch>${"가".repeat(64 * 1024)}</LawSearch>`
    const budget = new RequestExecutionBudget({
      ...DEFAULT_EXECUTION_LIMITS,
      maxUpstreamBodyBytes: 8_192,
      maxTotalUpstreamBodyBytes: 8_192,
    })

    await requestContext.run({ budget }, async () => {
      const response = new Response(body)
      // 종전: clone 전체 읽기가 예산을 초과해 정상 응답인데도 ExecutionLimitError로 죽었다
      await expect(followLawAntibot(
        response,
        "https://www.law.go.kr/DRF/lawSearch.do",
        new Headers(),
        1_000,
      )).resolves.toBeNull()
    })

    expect(budget.snapshot().upstreamBodyBytes).toBe(0)   // 검사 몫의 청구 없음
  })

  it("releases the response when cancellation aborts inspection", async () => {
    const controller = new AbortController()
    const response = new Response("normal body")
    controller.abort("cancelled")

    await expect(requestContext.run(
      { signal: controller.signal },
      () => followLawAntibot(
        response,
        "https://www.law.go.kr/DRF/original",
        new Headers(),
        1_000,
      ),
    )).rejects.toMatchObject({ name: "AbortError" })
    expect(response.bodyUsed).toBe(true)
  })
})
