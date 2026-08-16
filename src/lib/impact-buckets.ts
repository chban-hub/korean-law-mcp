/**
 * impact_map 버킷 가공 — 검색 결과를 항목 단위로 쪼개 조문 경계로 거르고 집계한다 (#90)
 *
 * 5개 하위 검색(판례·헌재·해석례·행정심판·자치법규)의 렌더 형식은 모두 같다:
 *   `[일련번호] 제목` + 들여쓴 `키: 값` 줄들 + 빈 줄.
 * 줄 단위로 훑으면 제목과 사건번호가 서로 다른 항목으로 흩어져 경계 판정을 걸 수 없다.
 * 항목 블록으로 묶은 뒤에야 "이 항목이 어느 조문 것인가"를 물을 수 있다.
 */
import { classifyArticleRefs, type ArticleAnchor } from "./article-anchor.js"

export interface BucketStat {
  /** 표시 기준 건수 — 표본이 검색 결과 전체를 덮으면 경계 통과 건수, 아니면 업스트림 검색 건수 */
  count: number
  topItems: string[]
  /** 조문 경계 불일치로 제외한 건수 */
  excluded: number
  /** 표본이 업스트림 검색 건수를 전부 덮었는지 */
  covered: boolean
}

const EMPTY: BucketStat = { count: 0, topItems: [], excluded: 0, covered: true }

const ITEM_HEADER_RE = /^\[\d+\]\s*\S/
// 5개 렌더러가 실제로 내보내는 식별 키만 적는다 — precedents/constitutional-decisions/
// admin-appeals는 `사건번호:`, interpretations는 `해석례번호:`, ordinance-search는 `지자체:`.
// 없는 키를 넣어두면 죽은 분기가 조용히 쌓인다.
const ITEM_DETAIL_RE = /^(사건번호|해석례번호|지자체)\s*:\s*(.+)$/

function summarizeItem(block: string[]): string {
  const header = block[0].replace(/\s*\([^)]*OC=[^)]*\)\s*/g, "").slice(0, 110)
  for (const line of block.slice(1)) {
    const m = ITEM_DETAIL_RE.exec(line)
    if (m) return `${header} · ${m[1]}: ${m[2]}`.slice(0, 150)
  }
  return header
}

/** 렌더된 검색 결과를 항목 블록으로 분해. 빈 줄이 항목 경계다(후속 안내문 혼입 차단). */
function splitItemBlocks(text: string): string[][] {
  const blocks: string[][] = []
  let current: string[] | null = null
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (ITEM_HEADER_RE.test(line)) {
      current = [line]
      blocks.push(current)
    } else if (current) {
      if (!line) current = null
      else current.push(line)
    }
  }
  return blocks
}

/**
 * 도구 결과에서 카운트 + 상위 항목 추출. 조문 경계에 어긋나는 항목은 버린다.
 * 조문 표기가 없는 항목(사건명만 있는 판례 등)은 판정 불가이므로 살린다 —
 * 앵커를 이유로 정상 결과를 죽이면 오탐을 오탐으로 갚는 셈이다.
 */
export function parseBucket(
  result: { text: string; isError: boolean },
  anchor: ArticleAnchor,
  maxItems: number
): BucketStat {
  if (result.isError || !result.text || !result.text.trim()) return EMPTY
  if (/\[NOT_FOUND\]/.test(result.text)) return EMPTY

  const cm = result.text.match(/총\s*(\d+)\s*건/)
  const searchCount = cm ? Number.parseInt(cm[1], 10) : 0

  const blocks = splitItemBlocks(result.text)
  if (blocks.length === 0) {
    // 알려진 5개 렌더 형식이 아니면 항목을 만들지 않는다 — 검증 못 한 것을 인용하지 않기 위해.
    return { count: searchCount, topItems: [], excluded: 0, covered: false }
  }

  const kept = blocks.filter(b => classifyArticleRefs(b.join(" "), anchor) !== "mismatch")
  const excluded = blocks.length - kept.length
  const covered = blocks.length >= searchCount
  const count = covered ? kept.length : searchCount

  return {
    count,
    topItems: kept.slice(0, maxItems).map(summarizeItem),
    excluded,
    covered,
  }
}

/** 건수 뒤에 붙는 경계 앵커 주석. 제외가 없으면 종전 출력과 동일하다. */
export function bucketNote(stat: BucketStat): string {
  if (stat.excluded === 0) return ""
  return stat.covered
    ? ` (조문 불일치 ${stat.excluded}건 제외)`
    : ` (검색 기준 — 표시분에서 조문 불일치 ${stat.excluded}건 제외)`
}

/** 조문 본문에서 인용된 다른 법령 추출 */
export function extractCitedLaws(articleText: string): string[] {
  if (!articleText) return []
  const cited = new Set<string>()
  // "「OO법」", "「OO에 관한 법률」" 패턴
  const bracketRe = /「([^」]{2,40}?(?:법|법률|시행령|시행규칙|규칙|규정))」/g
  let m: RegExpExecArray | null
  while ((m = bracketRe.exec(articleText)) !== null) {
    cited.add(m[1].trim())
  }
  return [...cited].slice(0, 10)
}

function safeMermaidId(s: string): string {
  return s.replace(/[^A-Za-z0-9가-힣]/g, "_").slice(0, 20)
}

export function buildMermaid(
  centerLabel: string,
  buckets: {
    precedents: number
    interpretations: number
    appeals: number
    constitutional: number
    ordinances: number
    citedLaws: string[]
  }
): string {
  const center = safeMermaidId(centerLabel) || "CENTER"
  const lines: string[] = ["graph LR"]
  lines.push(`    ${center}["⚖️ ${centerLabel}"]`)
  if (buckets.precedents > 0) lines.push(`    ${center} --> P["📚 대법원 판례 ${buckets.precedents}건"]`)
  if (buckets.constitutional > 0) lines.push(`    ${center} --> C["⚖️ 헌재 결정 ${buckets.constitutional}건"]`)
  if (buckets.interpretations > 0) lines.push(`    ${center} --> I["📑 법령해석 ${buckets.interpretations}건"]`)
  if (buckets.appeals > 0) lines.push(`    ${center} --> A["📋 행정심판 ${buckets.appeals}건"]`)
  if (buckets.ordinances > 0) lines.push(`    ${center} --> O["🏛️ 자치법규 ${buckets.ordinances}건"]`)
  if (buckets.citedLaws.length > 0) {
    buckets.citedLaws.slice(0, 5).forEach((law, i) => {
      lines.push(`    ${center} -.인용.-> L${i}["📖 ${law}"]`)
    })
  }
  return lines.join("\n")
}
