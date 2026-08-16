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
  /** 조문 경계를 통과한 건수 — 이 도구가 사실로 주장할 수 있는 유일한 수 */
  verified: number
  /** 업스트림 키워드 검색이 보고한 총건수. 유사 조번호·타 법령이 섞인 상한값이다 */
  searchCount: number
  topItems: string[]
  /** 조문 경계 불일치로 제외한 건수 */
  excluded: number
  /** 표본이 업스트림 검색 건수를 전부 덮었는지 */
  covered: boolean
}

const EMPTY: BucketStat = { verified: 0, searchCount: 0, topItems: [], excluded: 0, covered: true }

// 사건명이 비어 `[111] `만 오는 항목도 항목이다. `\S`를 요구하면 그 항목과 딸린
// 사건번호 줄이 통째로 사라져 표본 수가 줄고 covered 판정까지 뒤집힌다.
const ITEM_HEADER_RE = /^\[\d+\]/
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
    return { verified: 0, searchCount, topItems: [], excluded: 0, covered: false }
  }

  const kept = blocks.filter(b => classifyArticleRefs(b.join(" "), anchor) !== "mismatch")
  return {
    verified: kept.length,
    searchCount,
    topItems: kept.slice(0, maxItems).map(summarizeItem),
    excluded: blocks.length - kept.length,
    covered: blocks.length >= searchCount,
  }
}

/**
 * 버킷 한 줄. **주장하는 수는 항상 경계 통과 건수(verified)** 다.
 * 표본이 검색 결과를 못 덮으면 업스트림 총건수를 함께 적되, 그것이 검증된 수가 아님을
 * 문장으로 못박는다 — 예전에는 이 자리에 총건수만 적혀서 유사 조번호가 섞인 수를
 * "이 조문을 인용한 건수"로 단정했다(#90의 오탐이 수치에 그대로 남아 있었다).
 */
export function bucketLine(stat: BucketStat): string {
  const excl = stat.excluded > 0 ? ` (조문 불일치 ${stat.excluded}건 제외)` : ""
  if (stat.covered) return `${stat.verified}건${excl}`
  return `${stat.verified}건 확인${excl} / 검색 ${stat.searchCount}건 — 표본 ${stat.verified + stat.excluded}건만 경계 확인, 나머지는 미확인`
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
