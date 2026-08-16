import { describe, expect, it } from "vitest"
import { exceedsBatchLimit } from "./http-server.js"
import { parseHttpPort, readHttpServerConfig } from "./http-config.js"

describe("HTTP security configuration", () => {
  it("defaults to loopback without trusting forwarded headers", () => {
    const config = readHttpServerConfig({})
    expect(config.host).toBe("127.0.0.1")
    expect(config.trustProxy).toBe(false)
    expect(config.maxBatchCalls).toBe(20)
    expect(config.rateLimitRpm).toBe(60)
  })

  it("requires explicit authentication or override for non-loopback exposure", () => {
    expect(() => readHttpServerConfig({ MCP_HTTP_HOST: "0.0.0.0" })).toThrow("MCP_HTTP_HOST is non-loopback")
    expect(() => readHttpServerConfig({ MCP_HTTP_HOST: "0.0.0.0", MCP_AUTH_TOKEN: "   " })).toThrow("MCP_HTTP_HOST is non-loopback")
    expect(readHttpServerConfig({ MCP_HTTP_HOST: "0.0.0.0", MCP_AUTH_TOKEN: "secret" }).host).toBe("0.0.0.0")
    expect(readHttpServerConfig({ MCP_HTTP_HOST: "0.0.0.0", MCP_ALLOW_UNAUTHENTICATED_REMOTE: "1" }).allowUnauthenticatedRemote).toBe(true)
  })

  it("accepts only explicit numeric proxy hops", () => {
    expect(readHttpServerConfig({ TRUST_PROXY: "1" }).trustProxy).toBe(1)
    expect(() => readHttpServerConfig({ TRUST_PROXY: "true" })).toThrow("TRUST_PROXY must be an integer")
  })

  it("keeps the batch cap active when per-IP RPM limiting is disabled", () => {
    const config = readHttpServerConfig({ RATE_LIMIT_RPM: "0", MCP_MAX_BATCH_CALLS: "2" })
    const body = Array.from({ length: 3 }, () => ({ method: "tools/call" }))
    expect(config.rateLimitRpm).toBe(0)
    expect(exceedsBatchLimit(body, config.maxBatchCalls)).toBe(true)
  })

  it("fails startup configuration for invalid numeric limits", () => {
    expect(() => readHttpServerConfig({ RATE_LIMIT_RPM: "nope" })).toThrow("RATE_LIMIT_RPM must be an integer")
    expect(() => readHttpServerConfig({ MCP_MAX_BATCH_CALLS: "0" })).toThrow("MCP_MAX_BATCH_CALLS must be an integer")
    expect(() => readHttpServerConfig({ MCP_MAX_BODY_BYTES: "NaN" })).toThrow("MCP_MAX_BODY_BYTES must be an integer")
  })

  it("validates the HTTP port as a whole number", () => {
    expect(parseHttpPort(undefined, { PORT: "8123" })).toBe(8123)
    expect(() => parseHttpPort(undefined, { PORT: "8123oops" })).toThrow("PORT must be an integer")
  })
})
