/**
 * 긴 응답을 "의미 경계"에서 줄이는 전략 (schemas.ts의 truncate* 가 사용)
 *
 * 무조건 슬라이스는 문장 한가운데를 끊는다. 판례 full 응답은 한도의 90%대까지
 * 차므로 컷에 걸리는 실전 케이스가 보충·반대의견 말미이고, 문장 중간 소실은
 * 법적 실질을 바꿔 읽히게 한다(#92). 그래서 컷 지점을 마지막 완결 경계로 후퇴시킨다.
 *
 * 단, 후퇴는 상한을 둔다. 전원합의체 판결문처럼 한 문장이 수천 자에 이르는 글에서
 * "가장 가까운 경계"를 무제한 찾으면 경계 하나 없는 구간을 통째로 버리게 되어
 * 고치려던 것보다 큰 손실이 된다. 상한 안에 경계가 없으면 후퇴하지 않는다 —
 * 하드컷은 최소 손실이고, 후퇴는 그보다 나아질 때만 한다.
 */

/** 경계 후퇴 상한(자). 이 안에 경계가 없으면 하드컷을 유지한다. */
const MAX_BOUNDARY_BACKTRACK = 400

/** s 안에서 "종결부호 + 공백(또는 끝)"의 마지막 위치 → 종결부호 바로 뒤 인덱스 */
function lastSentenceEnd(s: string): number {
  let best = -1
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]
    if (ch !== "." && ch !== "!" && ch !== "?") continue
    const next = s[i + 1]
    if (next === undefined || /\s/.test(next)) {
      best = i + 1
      break
    }
  }
  return best
}

/**
 * text를 budget 자 이내로 자르되, 컷 지점을 마지막 완결 경계로 후퇴시킨다.
 * 우선순위: 줄 경계 > 문장 종결 > 후퇴 없음(하드컷).
 */
export function cutAtSafeBoundary(text: string, budget: number): string {
  if (budget <= 0) return ""
  if (text.length <= budget) return text

  const hard = text.slice(0, budget)
  const floor = Math.max(0, budget - MAX_BOUNDARY_BACKTRACK)

  // 1순위: 줄 경계. 이 서버의 응답은 줄 단위로 조립되므로(조문 한 줄, 표 한 행)
  // 줄이 곧 완결 단위다.
  const nl = hard.lastIndexOf("\n")
  if (nl >= floor && nl > 0) return hard.slice(0, nl)

  // 2순위: 문장 종결부호. 한국어 판결문은 "…다." 로 끝난다.
  const sentence = lastSentenceEnd(hard.slice(floor))
  if (sentence > 0) return hard.slice(0, floor + sentence)

  // 상한 안에 경계 없음 → 후퇴하지 않는다(무단 손실 0)
  return hard
}

/**
 * 핵심 내용 요약 추출 (truncateResponse summary 모드)
 * 첫 줄 + 모든 섹션 헤더(▶ ...) + 각 섹션의 처음 2줄 + 말미 안내
 */
export function extractSummary(text: string, maxSize: number): string {
  const lines = text.split("\n")
  const collected: string[] = []
  let budget = maxSize - 100 // 말미 안내 여유

  // 첫 줄(제목) 항상 포함
  if (lines.length > 0) {
    collected.push(lines[0])
    budget -= lines[0].length + 1
  }

  let i = 1
  while (i < lines.length && budget > 0) {
    const line = lines[i]
    // 섹션 헤더이거나 빈 줄이 아닌 경우
    if (/^▶|^#{1,4}\s|^=====|^-----/.test(line)) {
      collected.push("")
      collected.push(line)
      budget -= line.length + 2
      // 헤더 다음 2줄까지 포함
      let j = 1
      for (; j <= 2 && i + j < lines.length && budget > 0; j++) {
        const nextLine = lines[i + j]
        if (/^▶|^#{1,4}\s/.test(nextLine)) break // 다음 섹션이면 중단
        collected.push(nextLine)
        budget -= nextLine.length + 1
      }
      i += j // j 루프로 소비한 만큼 i를 추가 증가
    }
    i++
  }

  const tail = `\n\n📋 요약 모드: 원문 ${text.length.toLocaleString()}자 중 핵심만 추출 (${collected.join("\n").length.toLocaleString()}자)`
  return collected.join("\n") + tail
}
