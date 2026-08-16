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
const ARTICLE_REF_RE = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g

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

  const articleNo = Number.parseInt(code.slice(0, 4), 10)
  const branchNo = Number.parseInt(code.slice(4, 6), 10)
  if (!Number.isFinite(articleNo) || articleNo <= 0 || !Number.isFinite(branchNo)) return null
  return { code, display: formatJO(code), articleNo, branchNo }
}

/** 텍스트가 앵커 조문을 가리키는지 판정. 조문 표기가 없으면 silent(판정 보류). */
export function classifyArticleRefs(text: string, anchor: ArticleAnchor): AnchorVerdict {
  const folded = foldNotation(text || "")
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
