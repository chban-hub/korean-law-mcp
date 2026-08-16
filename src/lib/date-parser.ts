/**
 * 자연어 날짜 범위 파서
 * 검색 쿼리에서 시간 조건을 추출하여 YYYYMMDD 범위로 변환.
 * 패턴 테이블은 date-patterns.ts.
 */
import { TIME_PATTERNS } from "./date-patterns.js"
import type { DateRange } from "./date-types.js"

export type { DateRange }

export interface DateParseResult {
  /** 추출된 날짜 범위 (없으면 undefined) */
  range?: DateRange
  /**
   * 실제로 시간 표현으로 인식한 원문 조각.
   * 제거는 stripMatchedDate 가 이 조각으로 수행한다 — 정제된 문자열을 다시 파싱하면
   * 원문과 다른 패턴이 걸린다("2024년"으로 잡은 것이 "2024년 전"으로 재매칭).
   */
  matched?: string
}

/**
 * 시간 표현 바로 뒤에 남는 조사·부사.
 * "최근 3년" 만 지우면 "이내 개정된 도로교통법" 이 검색어가 된다 — 실호출 NOT_FOUND 확인(#100).
 * 뒤에 공백/문장끝이 오는 경우만 소비해 "간호법" 의 "간" 같은 낱글자를 갉아먹지 않는다.
 */
const TRAILING_PARTICLES =
  /^(?:\s*(?:이내|이후|이래|이전|동안|무렵|사이|이랑|랑|에서|부터|까지|하고|간|에|의|와|과)(?=\s|$))+/

/**
 * 이미 인식한 시간 표현과 그 뒤 조사 잔재를 문자열에서 걷어낸다.
 *
 * 재파싱하지 않는다 — 원문에서 "2024년"을 잡았는데 정제된 검색어를 다시 파싱하면
 * "2024년 전"(YYYY년 이전)처럼 **다른 패턴**이 걸려 엉뚱한 글자까지 먹는다.
 */
export function stripMatchedDate(query: string, matched: string): string {
  const idx = query.indexOf(matched)
  if (idx < 0) return query
  const before = query.slice(0, idx)
  const rest = query.slice(idx + matched.length)
  const particles = rest.match(TRAILING_PARTICLES)
  const after = particles ? rest.slice(particles[0].length) : rest
  return `${before} ${after}`.replace(/\s+/g, " ").trim()
}

/** 쿼리에서 시간 조건과 그 원문 조각을 추출. 제거는 stripMatchedDate 담당. */
export function parseDateRange(query: string): DateParseResult {
  for (const p of TIME_PATTERNS) {
    const m = query.match(p.regex)
    if (m) {
      return { range: p.resolve(m), matched: m[0] }
    }
  }
  return {}
}
