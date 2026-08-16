/**
 * 별표/서식 목록 수집 — 응답 봉투 파싱 + 페이지 수집.
 *
 * 업스트림(lawSearch.do + licbyl/ordinbyl/admbyl)은 display 를 100 초과로 올려도
 * numOfRows 를 100 으로 잘라 준다 (2026-08-17 실측: display=300 → returned 100).
 * 전 건을 보려면 page 를 넘겨 이어 받는 수밖에 없다.
 */

import type { LawApiClient } from "../lib/api-client.js"
import type { AnnexItem } from "./annex-select.js"

/** 업스트림이 한 페이지에 주는 최대 건수 (display 를 올려도 이 값에서 잘린다) */
export const ANNEX_PAGE_SIZE = 100

/**
 * 페이지 상한. 요청 단위 업스트림 예산은 기본 48회(MCP_MAX_UPSTREAM_REQUESTS)이고
 * get_annexes 는 목록 사다리(최대 4단계)·현행 본문 병합·별표 파일 다운로드까지 함께 쓴다.
 * 5페이지면 목록에 최대 5회를 써 500건을 담고도 예산의 약 1/10에 머문다.
 * 실측 최대 사례가 도로교통법 시행규칙 264건(3페이지)이라 실질 여유도 충분하다.
 */
export const MAX_ANNEX_PAGES = 5

export interface AnnexEnvelope {
  list: AnnexItem[]
  /** licbyl(법령) / ordinbyl(자치법규) / admrulbyl(행정규칙) 중 어느 봉투였는지 */
  type: string
  /** 업스트림이 밝힌 전체 건수 (없으면 0) */
  totalCnt: number
}

export interface CollectedAnnexes extends AnnexEnvelope {
  /** 상한에 걸려 전 건을 담지 못했는지 — 침묵하면 부분 목록이 전체로 읽힌다 */
  truncated: boolean
}

// 법제처 API는 결과 1건일 때 배열 대신 단일 객체를 반환하므로 정규화
const toArray = (v: unknown): AnnexItem[] =>
  v == null ? [] : Array.isArray(v) ? v : [v]

const count = (v: unknown): number => {
  const n = Number.parseInt(String(v ?? ""), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function parseAnnexEnvelope(jsonText: string): AnnexEnvelope {
  try {
    const json = JSON.parse(jsonText)
    const adminResult = json?.admRulBylSearch
    const licResult = json?.licBylSearch
    // 법제처 행정규칙 별표 응답의 배열 키는 admrulbyl (admbyl 아님). 구버전 호환 위해 admbyl도 폴백.
    if (adminResult?.admrulbyl ?? adminResult?.admbyl) {
      return {
        list: toArray(adminResult.admrulbyl ?? adminResult.admbyl),
        type: "admin",
        totalCnt: count(adminResult.totalCnt),
      }
    }
    if (licResult?.ordinbyl) {
      return { list: toArray(licResult.ordinbyl), type: "ordinance", totalCnt: count(licResult.totalCnt) }
    }
    if (licResult?.licbyl) {
      return { list: toArray(licResult.licbyl), type: "law", totalCnt: count(licResult.totalCnt) }
    }
    return { list: [], type: "law", totalCnt: 0 }
  } catch {
    // JSON 파싱 실패 (HTML 에러 페이지 등) → 빈 배열 반환하여 fallback 진행
    return { list: [], type: "law", totalCnt: 0 }
  }
}

/** 같은 번호를 별표와 서식이 나눠 쓰므로 번호만으로는 같은 항목인지 알 수 없다 */
const identity = (a: AnnexItem): string =>
  `${a.별표번호 ?? ""}|${a.별표종류 ?? ""}|${a.별표명 ?? ""}`

/**
 * 목록을 전 건 수집한다. totalCnt 가 첫 페이지를 넘으면 상한까지 page 를 이어 받는다.
 *
 * 루프는 세 겹으로 막혀 있다 — for 의 페이지 상한, 목표 건수 도달, 그리고
 * "새로 담긴 항목이 0건이면 중단". 마지막 것이 업스트림이 page 를 무시하고
 * 같은 페이지를 계속 돌려주는 경우의 방어선이다.
 */
export async function collectAnnexList(
  apiClient: LawApiClient,
  params: { lawName: string, knd?: "1" | "2" | "3" | "4" | "5", apiKey?: string }
): Promise<CollectedAnnexes> {
  const first = parseAnnexEnvelope(await apiClient.getAnnexes(params))
  const list = [...first.list]
  const wanted = Math.min(first.totalCnt, MAX_ANNEX_PAGES * ANNEX_PAGE_SIZE)
  if (list.length === 0 || list.length >= wanted) {
    return { ...first, list, truncated: first.totalCnt > list.length }
  }

  const seen = new Set(list.map(identity))
  for (let page = 2; page <= MAX_ANNEX_PAGES && list.length < wanted; page++) {
    const next = parseAnnexEnvelope(await apiClient.getAnnexes({ ...params, page }))
    const fresh = next.list.filter(a => !seen.has(identity(a)))
    if (fresh.length === 0) break
    fresh.forEach(a => seen.add(identity(a)))
    list.push(...fresh)
  }

  return { list, type: first.type, totalCnt: first.totalCnt, truncated: first.totalCnt > list.length }
}
