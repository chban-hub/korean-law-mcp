import { afterEach, describe, it, expect, vi } from "vitest"
import { followLawAntibot, parseAntibotUrl } from "./law-antibot.js"
import { requestContext } from "./session-state.js"

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
