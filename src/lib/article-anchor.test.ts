import { describe, it, expect } from "vitest"
import { parseArticleAnchor, classifyArticleRefs } from "./article-anchor.js"

describe("parseArticleAnchor — jo 입력 정규화 (#98)", () => {
  it("자연어 표기를 받는다", () => {
    expect(parseArticleAnchor("제103조")).toMatchObject({ code: "010300", display: "제103조" })
    expect(parseArticleAnchor("103조")).toMatchObject({ code: "010300", display: "제103조" })
    expect(parseArticleAnchor("제10조의2")).toMatchObject({ code: "001002", display: "제10조의2" })
  })

  it("6자리 JO 코드를 받는다 — get_law_text와 같은 계약", () => {
    expect(parseArticleAnchor("010300")).toMatchObject({ code: "010300", display: "제103조" })
    expect(parseArticleAnchor("001002")).toMatchObject({ code: "001002", display: "제10조의2" })
  })

  it("해석 불가 입력은 null", () => {
    expect(parseArticleAnchor("")).toBeNull()
    expect(parseArticleAnchor("조문")).toBeNull()
    expect(parseArticleAnchor("어딘가")).toBeNull()
  })

  // 적대적 리뷰 지적: buildJO는 조번호를 4자리로 pad할 뿐 상한이 없어 "10300"이
  // 7자리 코드가 된다. 통과시키면 헤더·검색어·JO가 전부 깨진 채 0건이 사실로 보고된다.
  it("6자리로 떨어지지 않는 숫자 입력은 거부한다 (#98 잔여)", () => {
    expect(parseArticleAnchor("10300")).toBeNull()
    expect(parseArticleAnchor("0010300")).toBeNull()
    expect(parseArticleAnchor("000000")).toBeNull()
  })
})

describe("classifyArticleRefs — 조번호 경계 앵커 (#90)", () => {
  const a103 = parseArticleAnchor("제103조")!
  const a10_2 = parseArticleAnchor("제10조의2")!

  it("제103조 질의에 제1032조·제1030조는 불일치", () => {
    expect(classifyArticleRefs("민법 제1032조 위헌소원", a103)).toBe("mismatch")
    expect(classifyArticleRefs("민법 제1030조 위헌확인", a103)).toBe("mismatch")
    expect(classifyArticleRefs("민법 제103조 위헌소원", a103)).toBe("match")
  })

  it("의X 가지번호를 구분한다", () => {
    expect(classifyArticleRefs("상법 제10조의2 관련", a10_2)).toBe("match")
    expect(classifyArticleRefs("상법 제10조 관련", a10_2)).toBe("mismatch")
    expect(classifyArticleRefs("상법 제10조의2 관련", a103)).toBe("mismatch")
    expect(classifyArticleRefs("민법 제103조의2", a103)).toBe("mismatch")
  })

  it("조문 표기가 없으면 판정 보류(silent) — 사건명만 있는 항목을 죽이지 않는다", () => {
    expect(classifyArticleRefs("손해배상(기)", a103)).toBe("silent")
    expect(classifyArticleRefs("동해시 시민법률상담 운영 조례", a103)).toBe("silent")
  })

  it("낫표·공백·한자 표기 변형에서도 정방향 매칭이 산다 (v4.9.0 표기 내성)", () => {
    expect(classifyArticleRefs("「민법」 제103조 위헌소원", a103)).toBe("match")
    expect(classifyArticleRefs("민법 제 103 조", a103)).toBe("match")
    expect(classifyArticleRefs("민법　제103조", a103)).toBe("match")  // 전각 공백
    expect(classifyArticleRefs("民法 第103條", a103)).toBe("match")
    expect(classifyArticleRefs("민법 제10조의2·제103조 관련", a103)).toBe("match")
  })

  it("항·호 표기는 조번호 경계를 흐리지 않는다", () => {
    expect(classifyArticleRefs("민법 제103조 제1항 제2호", a103)).toBe("match")
    expect(classifyArticleRefs("민법 제1032조 제1항", a103)).toBe("mismatch")
  })

  // 적대적 리뷰 지적 — 정당한 자료가 죽던 두 경계
  it("범위 표기 안에 드는 조문은 살린다", () => {
    const a104 = parseArticleAnchor("제104조")!
    expect(classifyArticleRefs("「민법」 제103조부터 제105조까지 관련", a104)).toBe("match")
    expect(classifyArticleRefs("민법 제103조~제105조", a104)).toBe("match")
    expect(classifyArticleRefs("「민법」 제103조부터 제105조까지 관련", parseArticleAnchor("제200조")!))
      .toBe("mismatch")
  })

  it("가지번호 하이픈 표기를 앵커가 스스로 알아본다", () => {
    const a10_2 = parseArticleAnchor("제10조-2")!
    expect(a10_2.code).toBe("001002")
    expect(classifyArticleRefs("상법 제10조-2 관련", a10_2)).toBe("match")
    expect(classifyArticleRefs("상법 제10조의2 관련", a10_2)).toBe("match")
  })
})
