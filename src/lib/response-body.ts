/** Bounded, cancellable readers for upstream Fetch responses. */

import { getRequestSignal, requestCancelledError, requestContext, throwIfRequestCancelled } from "./session-state.js"

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length")
  if (!raw || !/^(?:0|[1-9]\d*)$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The underlying fetch may already have closed the stream.
  }
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> {
  if (!signal) return reader.read()
  if (signal.aborted) {
    await cancelReader(reader)
    throw requestCancelledError(signal.reason)
  }

  return new Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>>((resolve, reject) => {
    const onAbort = () => {
      void cancelReader(reader)
      reject(requestCancelledError(signal.reason))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    reader.read().then(
      value => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Consume one upstream body while enforcing the request context's byte
 * budgets.  `Response.text()` and `arrayBuffer()` provide no size hook, so
 * using a reader is what lets cancellation and limits stop work in flight.
 */
export async function readResponseBytes(response: Response): Promise<Uint8Array> {
  throwIfRequestCancelled()
  const budget = requestContext.getStore()?.budget
  const declaredSize = contentLength(response)
  if (budget && declaredSize !== undefined) {
    try {
      budget.ensureResponseBodySize(declaredSize)
    } catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    }
  }

  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await readChunk(reader, getRequestSignal())
      if (done) break
      if (!value) continue

      length += value.byteLength
      if (budget) {
        try {
          budget.ensureResponseBodySize(length)
          budget.consumeUpstreamBody(value.byteLength)
        } catch (error) {
          await cancelReader(reader)
          throw error
        }
      }
      chunks.push(value)
    }
  } catch (error) {
    await cancelReader(reader)
    throw error
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function readResponseText(response: Response): Promise<string> {
  return new TextDecoder().decode(await readResponseBytes(response))
}

export async function readResponseArrayBuffer(response: Response): Promise<ArrayBuffer> {
  const bytes = await readResponseBytes(response)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
