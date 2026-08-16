/**
 * 법제처 DRF가 "그 레코드는 없다"를 표현하는 방식.
 *
 * DRF는 실패도 전부 HTTP 200으로 답하고, 미스 본문의 형태는 target×type 조합이
 * 결정한다 (2026-08-16 34조합 전수 실측 — _workspace/04_qa_verification.md §3.2).
 *
 *   - 단건 조회 대다수: 정상 XML/JSON 봉투 + "일치하는 …없습니다" → 걸러낼 것 없음
 *   - `prec`/`thdCmp`/`lsStmd` + JSON: 200 + **0바이트**
 *   - `lsStmd` + XML: 200 + 권한 안내 HTML (문안이 OC 키의 API 신청 상태에 의존하므로
 *     문구 매칭으로 분류해서는 안 된다)
 *   - 검색(`lawSearch.do`)은 18/18 전부 정상 봉투 — 빈 본문/HTML이 오면 그건 진짜 장애다
 *
 * 그래서 "빈 본문 = 미스일 수 있다"는 읽기는 **단건 조회 경로에서만** 참이다.
 * 그마저도 본문만으로는 미스와 점검·과부하를 구별할 수 없으므로, 호출부가
 * `singleRecordLookup`을 켠 경로에서만 짧은 확인 재시도 1회를 거쳐 미스로 확정한다.
 */

import { ExecutionLimitError } from "./execution-limits.js"
import { readResponseText } from "./response-body.js"
import { getRequestSignal } from "./session-state.js"

export type BadBodyKind = "empty" | "html"

/**
 * 법제처 API가 200으로 빈 본문/HTML(점검·과부하 페이지, 권한 안내 페이지)을 반환한
 * 경우를 감지. 정상 응답은 XML(`<`) 또는 JSON(`{`/`[`)으로 시작한다.
 */
export function detectBadBody(text: string): BadBodyKind | null {
  const t = text.trim()
  if (!t) return "empty"
  if (/^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)) return "html"
  return null
}

/**
 * 200 응답의 본문을 (예산·취소를 지키며) 훔쳐봐 미스/장애 표시인지 판정한다.
 * 본문을 읽지 못하면(clone 실패 등) 정상 응답으로 보고 `null`을 돌려주고,
 * 취소·예산 초과는 호출부가 요청을 중단하도록 그대로 던진다.
 */
export async function classifyOkBody(
  response: Response,
  externalSignal?: AbortSignal,
): Promise<BadBodyKind | null> {
  const inspection = response.clone()
  try {
    return detectBadBody(await readResponseText(inspection))
  } catch (error) {
    if (error instanceof ExecutionLimitError || getRequestSignal()?.aborted || externalSignal?.aborted) {
      await Promise.allSettled([inspection.body?.cancel(), response.body?.cancel()])
      throw error
    }
    void inspection.body?.cancel().catch(() => {})
    return null
  }
}

/** 미스 확인 재시도 간격 — 업스트림 p50 왕복(0.4~1.1초)보다 짧게 잡아 한 번만 되묻는다. */
export const MISS_CONFIRM_DELAY_MS = 200

/**
 * 단건 조회가 확인 재시도 후에도 빈 본문/안내 페이지만 돌려준 경우.
 * 빈 결과를 정상 응답으로 흘려보내지 않기 위해 명시적으로 던진다.
 */
export class UpstreamRecordMissingError extends Error {
  /** @param maskedUrl 이미 `maskSensitiveUrl()`을 통과한 URL (API 키 유출 방지) */
  constructor(maskedUrl: string, kind: BadBodyKind) {
    super(
      `법제처 API가 요청한 자료를 반환하지 않았습니다(${kind === "empty" ? "빈 본문" : "안내 페이지"}). ` +
      `ID/MST가 검색 결과에서 얻은 값인지 확인하세요. 법제처 점검·과부하 중에도 같은 응답이 올 수 있습니다. ` +
      `- ${maskedUrl}`
    )
    this.name = "UpstreamRecordMissingError"
  }
}
