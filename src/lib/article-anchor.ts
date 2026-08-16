/**
 * 조문 경계 앵커 — "제103조"와 "제1032조"를 가르는 규칙 (#90, #98)
 *
 * 법제처 검색은 조번호를 부분 문자열로 물어온다("민법 제103조" 질의에 「민법 제1032조
 * 위헌소원」이 최상위로 섞임). 인용 그래프는 "이 조문을 인용했다"는 사실 주장을 하므로
 * 이 오탐은 그대로 잘못된 근거가 된다. 검색 결과를 조 단위로 다시 판정해 걸러낸다.
 *
 * 판정은 3값이다 — 매칭/불일치만 두면 사건명에 조문 표기가 없는 정상 항목
 * (예: "손해배상(기)")까지 죽는다. 판정 불가는 'silent'로 남겨 호출자가 살린다.
 */
import { buildJO, formatJO } from "./law-parser.js"

export interface ArticleAnchor {
  /** 6자리 JO 코드 (AAAABB) */
  code: string
  /** 자연어 표기 (제103조 / 제10조의2) */
  display: string
  /** 조번호 — 정수. 레포 전반의 `jo`는 문자열(코드·표기)이라 이름을 겹치지 않게 한다 */
  articleNo: number
  /** 가지번호 (의X). 없으면 0 */
  branchNo: number
}

export type AnchorVerdict = "match" | "mismatch" | "silent"

/** 한자·이체자 표기를 한글 표기로 접는다 (law-parser의 정규화와 같은 대응) */
function foldNotation(text: string): string {
  return text.replace(/第/g, "제").replace(/條/g, "조").replace(/之/g, "의")
}

// 조문 참조 패턴. `(\d+)`가 탐욕적이라 "제1032조"는 1032 하나로만 잡히고,
// 부분 문자열 103은 만들어지지 않는다 — 이것이 경계 그 자체다.
// `\s*`는 전각 공백(U+3000)도 흡수하므로 낫표·공백 변형 표기에 내성이 있다.
// 가지번호는 `의2`와 `-2`를 모두 받는다 — buildJO가 둘 다 받으므로, 여기서 `-`를 빼면
// 앵커가 자기 입력 표기("제10조-2")를 스스로 못 알아보고 정당한 항목을 떨어뜨린다.
const ARTICLE_REF_RE = /제\s*(\d+)\s*조(?:\s*(?:의|-)\s*(\d+))?/g
// "제103조부터 제105조까지" 같은 범위 표기. 범위 안의 조문은 인용된 것이 맞으므로
// 양 끝만 보고 불일치로 버리면 정당한 자료가 죽는다.
// 뒤따르는 "까지"는 선택 — "제103조~제105조"처럼 생략된 표기가 흔하다. 시작 쪽 `제`를
// 요구하므로 가지번호 하이픈("제10조-2")을 범위로 오인하지 않는다.
const ARTICLE_RANGE_RE = /제\s*(\d+)\s*조(?:\s*(?:의|-)\s*\d+)?\s*(?:부터|~|∼|-)\s*제\s*(\d+)\s*조(?:\s*(?:의|-)\s*\d+)?(?:\s*까지)?/g

/**
 * jo 입력을 앵커로 정규화. 자연어 표기와 6자리 JO 코드를 모두 받는다
 * (get_law_text와 같은 계약 — #98). 해석 불가면 null.
 */
export function parseArticleAnchor(raw: string): ArticleAnchor | null {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return null

  let code: string
  if (/^\d{6}$/.test(trimmed)) {
    code = trimmed
  } else {
    try {
      code = buildJO(trimmed)
    } catch {
      return null
    }
  }

  // buildJO는 조번호를 4자리로 pad할 뿐 상한을 두지 않아 "10300"이 "1030000"(7자리)이 된다.
  // 그대로 흘려보내면 formatJO가 원문을 되돌려주고 헤더·검색어·JO 파라미터가 모두 깨진 채
  // 전건 0건이 사실로 보고된다 — #98이 지적한 바로 그 실패다. 6자리가 아니면 거부한다.
  if (code.length !== 6) return null
  const articleNo = Number.parseInt(code.slice(0, 4), 10)
  const branchNo = Number.parseInt(code.slice(4, 6), 10)
  if (!Number.isFinite(articleNo) || articleNo <= 0 || !Number.isFinite(branchNo)) return null
  return { code, display: formatJO(code), articleNo, branchNo }
}

/** 텍스트가 앵커 조문을 가리키는지 판정. 조문 표기가 없으면 silent(판정 보류). */
export function classifyArticleRefs(text: string, anchor: ArticleAnchor): AnchorVerdict {
  const folded = foldNotation(text || "")

  // 범위 표기를 먼저 본다 — 범위 안에 들면 양 끝 조번호가 달라도 인용된 것이 맞다.
  let r: RegExpExecArray | null
  ARTICLE_RANGE_RE.lastIndex = 0
  while ((r = ARTICLE_RANGE_RE.exec(folded)) !== null) {
    const from = Number.parseInt(r[1], 10)
    const to = Number.parseInt(r[2], 10)
    if (from <= anchor.articleNo && anchor.articleNo <= to) return "match"
  }

  let sawRef = false
  let m: RegExpExecArray | null
  ARTICLE_REF_RE.lastIndex = 0
  while ((m = ARTICLE_REF_RE.exec(folded)) !== null) {
    sawRef = true
    const articleNo = Number.parseInt(m[1], 10)
    const branchNo = m[2] ? Number.parseInt(m[2], 10) : 0
    if (articleNo === anchor.articleNo && branchNo === anchor.branchNo) return "match"
  }
  return sawRef ? "mismatch" : "silent"
}
