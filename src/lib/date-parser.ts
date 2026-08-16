/**
 * 자연어 날짜 범위 파서
 * 검색 쿼리에서 시간 조건을 추출하여 YYYYMMDD 범위로 변환.
 */

export interface DateRange {
  /** 시작일 (YYYYMMDD) */
  from: string
  /** 종료일 (YYYYMMDD) */
  to: string
}

export interface DateParseResult {
  /** 추출된 날짜 범위 (없으면 undefined) */
  range?: DateRange
  /** 날짜 표현을 제거한 쿼리 (검색용) */
  cleanQuery: string
  /** 실제로 시간 표현으로 인식한 원문 조각 — 다른 문자열에서 같은 것을 지울 때 쓴다 */
  matched?: string
}

/** YYYYMMDD 포맷 */
function fmt(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}${m}${day}`
}

/** 오늘 기준 N개월 전 */
function monthsAgo(n: number, base: Date = new Date()): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() - n)
  return d
}

/** 오늘 기준 N년 전 */
function yearsAgo(n: number, base: Date = new Date()): Date {
  const d = new Date(base)
  d.setFullYear(d.getFullYear() - n)
  return d
}

/** 오늘 기준 N일 전 */
function daysAgo(n: number, base: Date = new Date()): Date {
  const d = new Date(base)
  d.setDate(d.getDate() - n)
  return d
}

/** 특정 연/월의 첫날 */
function monthStart(year: number, month: number): Date {
  return new Date(year, month - 1, 1)
}

/** 특정 연/월의 마지막날 */
function monthEnd(year: number, month: number): Date {
  return new Date(year, month, 0)
}

interface TimePattern {
  regex: RegExp
  resolve: (m: RegExpMatchArray) => DateRange
}

const patterns: TimePattern[] = [
  // "2020년부터 2023년까지" / "2020~2023"
  {
    regex: /(\d{4})\s*(?:년\s*)?(?:부터|~|–|-)\s*(\d{4})\s*(?:년\s*)?(?:까지)?/,
    resolve: (m) => ({
      from: `${m[1]}0101`,
      to: `${m[2]}1231`,
    }),
  },
  // "최근 N년"
  {
    regex: /최근\s*(\d+)\s*년/,
    resolve: (m) => ({
      from: fmt(yearsAgo(parseInt(m[1], 10))),
      to: fmt(new Date()),
    }),
  },
  // "최근 N개월"
  {
    regex: /최근\s*(\d+)\s*개월/,
    resolve: (m) => ({
      from: fmt(monthsAgo(parseInt(m[1], 10))),
      to: fmt(new Date()),
    }),
  },
  // "YYYY년 이후" / "YYYY년부터"
  {
    regex: /(\d{4})\s*년\s*(?:이후|이래|부터)/,
    resolve: (m) => ({
      from: `${m[1]}0101`,
      to: fmt(new Date()),
    }),
  },
  // "YYYY년 이전" / "YYYY년까지"
  {
    regex: /(\d{4})\s*년\s*(?:이전|까지|전)/,
    resolve: (m) => ({
      from: "19480101",
      to: `${m[1]}1231`,
    }),
  },
  // "N개월 전"
  {
    regex: /(\d+)\s*개월\s*전/,
    resolve: (m) => {
      const t = monthsAgo(parseInt(m[1], 10))
      return { from: fmt(monthStart(t.getFullYear(), t.getMonth() + 1)), to: fmt(monthEnd(t.getFullYear(), t.getMonth() + 1)) }
    },
  },
  // "YYYY년 N월" (특정 월)
  {
    regex: /(\d{4})\s*년\s*(\d{1,2})\s*월/,
    resolve: (m) => {
      const y = parseInt(m[1], 10)
      const mo = parseInt(m[2], 10)
      return { from: fmt(monthStart(y, mo)), to: fmt(monthEnd(y, mo)) }
    },
  },
  // "올해 상반기" / "올해 하반기"
  {
    regex: /올해\s*(상반기|하반기)/,
    resolve: (m) => {
      const y = new Date().getFullYear()
      if (m[1] === "상반기") return { from: `${y}0101`, to: `${y}0630` }
      return { from: `${y}0701`, to: `${y}1231` }
    },
  },
  // "지난달" / "이번달" / "저번달"
  {
    regex: /(지난달|저번달|이번\s*달)/,
    resolve: (m) => {
      const now = new Date()
      if (/이번/.test(m[1])) {
        return { from: fmt(monthStart(now.getFullYear(), now.getMonth() + 1)), to: fmt(monthEnd(now.getFullYear(), now.getMonth() + 1)) }
      }
      const p = monthsAgo(1, now)
      return { from: fmt(monthStart(p.getFullYear(), p.getMonth() + 1)), to: fmt(monthEnd(p.getFullYear(), p.getMonth() + 1)) }
    },
  },
  // "지난주" / "이번주"
  {
    regex: /(지난주|이번\s*주)/,
    resolve: (m) => {
      const now = new Date()
      const day = now.getDay() // 0=Sun
      if (/이번/.test(m[1])) {
        const mon = daysAgo(day === 0 ? 6 : day - 1, now)
        const sun = new Date(mon)
        sun.setDate(mon.getDate() + 6)
        return { from: fmt(mon), to: fmt(sun) }
      }
      // 지난주: 이번주 월요일 -7 ~ -1
      const thisMon = daysAgo(day === 0 ? 6 : day - 1, now)
      const lastMon = daysAgo(7, thisMon)
      const lastSun = daysAgo(1, thisMon)
      return { from: fmt(lastMon), to: fmt(lastSun) }
    },
  },
  // "작년" / "올해" / "재작년"
  {
    regex: /(재작년|작년|올해|금년)/,
    resolve: (m) => {
      const now = new Date()
      const y = now.getFullYear()
      let target = y
      if (m[1] === "작년") target = y - 1
      else if (m[1] === "재작년") target = y - 2
      return { from: `${target}0101`, to: `${target}1231` }
    },
  },
  // "최신" / "요즘" / "근래" → 최근 3년
  {
    regex: /(?:^|\s)(최신|요즘|근래)(?:\s|$)/,
    resolve: () => ({
      from: fmt(yearsAgo(3)),
      to: fmt(new Date()),
    }),
  },
  // "YYYY년" 단독 — 그 해 전체. 반드시 마지막에 둔다(위 구체 패턴이 먼저 잡아야 한다).
  // 앞뒤에 또 다른 "YYYY년"이 있으면 두 시점 비교이므로 여기서 처리하지 않는다 —
  // 잡으면 time_travel 이 뽑아 둔 toDate 를 그 해 말일로 덮어쓴다(양방향 확인 필수)
  {
    regex: /(?<!\d{4}\s*년[\s\S]{0,20})(\d{4})\s*년(?![\s\S]{0,20}\d{4}\s*년)/,
    resolve: (m) => ({ from: `${m[1]}0101`, to: `${m[1]}1231` }),
  },
]

/**
 * 시간 표현 바로 뒤에 남는 조사·부사.
 * "최근 3년" 만 지우면 "이내 개정된 도로교통법" 이 검색어가 된다 — 실호출 NOT_FOUND 확인(#100).
 * 뒤에 공백/문장끝이 오는 경우만 소비해 "간호법" 의 "간" 같은 낱글자를 갉아먹지 않는다.
 */
const TRAILING_PARTICLES =
  /^(?:\s*(?:이내|이후|이래|이전|동안|무렵|사이|이랑|랑|에서|부터|까지|하고|간|에|의|와|과)(?=\s|$))+/

/** 매칭된 시간 표현과 그 뒤 조사 잔재를 함께 제거 */
function removeTimeExpression(query: string, matched: string): string {
  const idx = query.indexOf(matched)
  if (idx < 0) return query
  const before = query.slice(0, idx)
  const rest = query.slice(idx + matched.length)
  const particles = rest.match(TRAILING_PARTICLES)
  const after = particles ? rest.slice(particles[0].length) : rest
  return `${before} ${after}`.replace(/\s+/g, " ").trim()
}

/** 쿼리에서 시간 조건을 추출하고, 날짜 표현을 제거한 검색어를 반환. */
export function parseDateRange(query: string): DateParseResult {
  for (const p of patterns) {
    const m = query.match(p.regex)
    if (m) {
      return { range: p.resolve(m), cleanQuery: removeTimeExpression(query, m[0]), matched: m[0] }
    }
  }
  return { cleanQuery: query }
}

/**
 * 이미 인식한 시간 표현을 다른 문자열에서 걷어낸다.
 *
 * 재파싱하지 않는다 — 원문에서 "2024년"을 잡았는데 정제된 검색어를 다시 파싱하면
 * "2024년 전"(YYYY년 이전)처럼 **다른 패턴**이 걸려 엉뚱한 글자까지 먹는다.
 */
export function stripMatchedDate(text: string, matched: string): string {
  return removeTimeExpression(text, matched)
}
