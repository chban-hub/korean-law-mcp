/** Bounded, cancellable readers for upstream Fetch responses. */

import { getRequestSignal, requestCancelledError, requestContext, throwIfRequestCancelled } from "./session-state.js"

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length")
  if (!raw || !/^(?:0|[1-9]\d*)$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

/**
 * 본문 읽기를 포기한다 — **절대 await하지 않는다.**
 *
 * `response.clone()`을 하면 본문이 tee되는데, tee의 한쪽 가지만 취소하면 그 취소
 * 프라미스는 나머지 가지가 취소될 때까지 settle되지 않는다(웹 스트림 규약). 정리용
 * 취소를 await하면 그 자리에서 영원히 멈춘다 — 2 MiB 초과 본문에서 도구 호출이
 * 에러 대신 300초 타임아웃으로 끝나던 원인이다(#115). 취소는 정리일 뿐이므로
 * 완료를 기다릴 이유가 없다.
 */
function abandonReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => {})
}

function abandonBody(response: Response): void {
  void response.body?.cancel().catch(() => {})
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> {
  if (!signal) return reader.read()
  if (signal.aborted) {
    abandonReader(reader)
    throw requestCancelledError(signal.reason)
  }

  return new Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>>((resolve, reject) => {
    const onAbort = () => {
      abandonReader(reader)
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
      abandonBody(response)
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
          abandonReader(reader)
          throw error
        }
      }
      chunks.push(value)
    }
  } catch (error) {
    abandonReader(reader)
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

/**
 * 본문 앞부분만 읽는다 — 봉투가 정상인지 훔쳐보는 용도. 예산에는 청구하지 않는다.
 * 같은 바이트를 진짜 읽기가 다시 청구하므로 여기서 세면 이중 계상이 된다.
 *
 * `complete`는 `maxBytes`에 닿기 전에 본문이 끝났는지 — 즉 읽은 내용이 본문 전부인지다.
 * 앞부분만 보고 "빈 본문"이라 단정하지 않으려면 호출부가 이 값을 봐야 한다.
 */
export async function readBodyPrefix(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; complete: boolean }> {
  throwIfRequestCancelled()
  if (!response.body) return { text: "", complete: true }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let complete = false
  try {
    while (length < maxBytes) {
      const { done, value } = await readChunk(reader, getRequestSignal())
      if (done) { complete = true; break }
      if (!value) continue
      chunks.push(value)
      length += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(bytes), complete }
}

export async function readResponseArrayBuffer(response: Response): Promise<ArrayBuffer> {
  const bytes = await readResponseBytes(response)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
