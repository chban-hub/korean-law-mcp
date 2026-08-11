import { describe, expect, it, vi } from "vitest"
import { DEFAULT_EXECUTION_LIMITS, ExecutionLimitError, RequestExecutionBudget, readExecutionLimits } from "./execution-limits.js"
import { sleep } from "./fetch-with-retry.js"
import { readResponseText } from "./response-body.js"
import { requestContext, runWithRequestContext } from "./session-state.js"

describe("request-wide execution limits", () => {
  it("charges every upstream attempt against one shared budget", () => {
    const budget = new RequestExecutionBudget({ ...DEFAULT_EXECUTION_LIMITS, maxUpstreamRequests: 2 })
    budget.consumeUpstreamRequest()
    budget.consumeUpstreamRequest()
    expect(() => budget.consumeUpstreamRequest()).toThrow(ExecutionLimitError)
    expect(budget.snapshot().upstreamRequests).toBe(3)
  })

  it("stops an oversized upstream response before buffering it", async () => {
    const budget = new RequestExecutionBudget({
      ...DEFAULT_EXECUTION_LIMITS,
      maxUpstreamBodyBytes: 4,
      maxTotalUpstreamBodyBytes: 8,
    })
    await expect(requestContext.run({ budget }, () => readResponseText(new Response("12345"))))
      .rejects.toThrow(ExecutionLimitError)
  })

  it("shares the total body allowance across reads in one outer request", async () => {
    const budget = new RequestExecutionBudget({
      ...DEFAULT_EXECUTION_LIMITS,
      maxUpstreamBodyBytes: 8,
      maxTotalUpstreamBodyBytes: 5,
    })
    await requestContext.run({ budget }, async () => {
      await expect(readResponseText(new Response("123"))).resolves.toBe("123")
      await expect(readResponseText(new Response("456"))).rejects.toThrow(ExecutionLimitError)
    })
  })

  it("cancels a pending body read", async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }))
    const pending = requestContext.run({ signal: controller.signal }, () => readResponseText(response))

    controller.abort("client cancelled")
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("interrupts retry backoff when the MCP item is cancelled", async () => {
    const controller = new AbortController()
    const pending = sleep(10_000, controller.signal)
    controller.abort("client cancelled")
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
  })

  it("keeps MCP cancellation item-scoped while batch accounting is shared", () => {
    const connection = new AbortController()
    const firstItem = new AbortController()
    const secondItem = new AbortController()
    const budget = new RequestExecutionBudget(DEFAULT_EXECUTION_LIMITS)
    let firstSignal: AbortSignal | undefined
    let secondSignal: AbortSignal | undefined

    requestContext.run({ signal: connection.signal, budget }, () => {
      runWithRequestContext({ signal: firstItem.signal }, () => {
        firstSignal = requestContext.getStore()?.signal
        expect(requestContext.getStore()?.budget).toBe(budget)
      })
      runWithRequestContext({ signal: secondItem.signal }, () => {
        secondSignal = requestContext.getStore()?.signal
        expect(requestContext.getStore()?.budget).toBe(budget)
      })
    })

    firstItem.abort("first item cancelled")
    expect(firstSignal?.aborted).toBe(true)
    expect(secondSignal?.aborted).toBe(false)

    connection.abort("connection closed")
    expect(secondSignal?.aborted).toBe(true)
  })

  it("rejects malformed execution limit values instead of treating them as disabled", () => {
    expect(() => readExecutionLimits({ MCP_MAX_UPSTREAM_REQUESTS: "48oops" })).toThrow(
      "MCP_MAX_UPSTREAM_REQUESTS must be an integer",
    )
  })
})
