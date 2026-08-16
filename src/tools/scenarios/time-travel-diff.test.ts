import { describe, it, expect } from "vitest"
import { changeExcerpt, excerptBudget, extractLawSnapshot, dot, snapToClauseStart } from "./time-travel-diff.js"

describe("extractLawSnapshot 출처 메타 (#96)", () => {
  const json = {
    법령: {
      기본정보: { 공포번호: "19924", 공포일자: "20231231", 제개정구분: "일부개정" },
      조문: {
        조문단위: [
          { 조문여부: "조문", 조문번호: "1", 조문제목: "목적", 조문내용: "제1조(목적) …", 조문시행일자: "20240101" },
          { 조문여부: "전문", 조문내용: "무시" },
        ],
      },
    },
  }

  it("공포번호·공포일자·제개정구분을 함께 뽑는다", () => {
    const s = extractLawSnapshot(json)
    expect(s.ancNo).toBe("19924")
    expect(s.ancYd).toBe("20231231")
    expect(s.rrCls).toBe("일부개정")
  })

  it("조문시행일자를 조문별로 보존한다", () => {
    expect(extractLawSnapshot(json).articles[0].efYd).toBe("20240101")
  })

  it("조문이 아닌 단위는 제외한다", () => {
    expect(extractLawSnapshot(json).articles).toHaveLength(1)
  })

  it("dot는 YYYYMMDD를 표기용으로 바꾼다", () => {
    expect(dot("20231231")).toBe("2023.12.31")
    expect(dot("")).toBe("")
  })
})

// #97: 앞에서부터 자르면 개정이 조문 후반에 있을 때 [전]/[후]가 똑같이 나와
// 소비 LLM이 조문을 다시 조회한다. 변경 지점을 중심으로 잡아야 한다.
const HEAD = "이 법에서 사용하는 용어의 뜻은 다음과 같다. ".repeat(12)   // 공통 앞머리(300자 이상)
const OLD = HEAD + "관세청장은 기획재정부장관의 승인을 받아 고시한다."
const CUR = HEAD + "관세청장은 재정경제부장관의 승인을 받아 고시한다."

describe("changeExcerpt 변경 지점 중심 발췌 (#97)", () => {
  it("변경된 부분이 [전]/[후] 양쪽에 실제로 담긴다", () => {
    const ex = changeExcerpt(OLD, CUR, 200)
    expect(ex.before).toContain("기획재정부장관")
    expect(ex.after).toContain("재정경제부장관")
  })

  it("[전]과 [후]가 서로 달라진다 (앞머리 슬라이스는 동일해져 무의미)", () => {
    const ex = changeExcerpt(OLD, CUR, 200)
    expect(ex.before).not.toBe(ex.after)
    // 종전 방식(앞 120자)은 둘이 같아 아무 정보도 주지 못했다
    expect(OLD.slice(0, 120)).toBe(CUR.slice(0, 120))
  })

  it("공통 앞머리는 생략 표시로 줄인다", () => {
    const ex = changeExcerpt(OLD, CUR, 200)
    expect(ex.before.startsWith("…")).toBe(true)
    expect(ex.before.length).toBeLessThan(OLD.length)
  })

  it("변경 구간이 예산 안이면 잘림 표시를 하지 않는다", () => {
    expect(changeExcerpt(OLD, CUR, 200).clipped).toBe(false)
  })

  it("변경 구간이 예산을 넘으면 clipped로 알린다", () => {
    const long = "가".repeat(600)
    const ex = changeExcerpt("머리말 " + long, "머리말 " + "나".repeat(600), 200)
    expect(ex.clipped).toBe(true)
  })

  it("변경이 없으면 발췌도 비어 있다", () => {
    const ex = changeExcerpt("동일한 본문", "동일한 본문", 200)
    expect(ex.clipped).toBe(false)
  })
})

describe("snapToClauseStart 단서 중간 시작 방지 (#97)", () => {
  const body = "제8조(기간) ① 이 법에 따른 기간의 계산은 민법에 따른다. ② 다음 각 호의 날은 기한에서 제외한다. 1. 토요일 및 일요일 2. 공휴일"

  it("항 머리(①②)로 당긴다", () => {
    const mid = body.indexOf("다음 각 호의")
    expect(body[snapToClauseStart(body, mid)]).toBe("②")
  })

  it("호 머리(1. 2.)로 당긴다", () => {
    const mid = body.indexOf("토요일")
    expect(body.slice(snapToClauseStart(body, mid))).toMatch(/^1\.\s/)
  })

  it("앞으로만 당긴다 — 내용을 잃지 않는다", () => {
    const mid = body.indexOf("공휴일")
    expect(snapToClauseStart(body, mid)).toBeLessThanOrEqual(mid)
  })

  it("탐색 폭 안에 경계가 없으면 그대로 둔다", () => {
    const flat = "경계표시가전혀없는긴한글본문".repeat(20)
    expect(snapToClauseStart(flat, 200)).toBe(200)
  })

  it("시작이 0이면 당기지 않는다", () => {
    expect(snapToClauseStart(body, 0)).toBe(0)
  })
})

describe("excerptBudget 예산 배분 (#97)", () => {
  it("변경 조문이 많으면 조문당 예산을 줄인다", () => {
    expect(excerptBudget(30)).toBeLessThan(excerptBudget(5))
  })

  it("상·하한을 벗어나지 않는다", () => {
    expect(excerptBudget(1)).toBeLessThanOrEqual(260)
    expect(excerptBudget(1000)).toBeGreaterThanOrEqual(120)
  })

  it("총 예산은 상한을 지킨다 (응답이 절단 한도로 밀리지 않게)", () => {
    const shown = 30
    expect(excerptBudget(shown) * 2 * shown).toBeLessThanOrEqual(12000)
  })
})
