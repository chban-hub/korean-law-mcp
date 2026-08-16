import { describe, it, expect } from "vitest"
import { extractCaseNumbers, isImpossibleCaseNumber, verifyCaseCitations } from "./case-citation.js"
import type { LawApiClient } from "./api-client.js"

describe("extractCaseNumbers — 사건번호 인용 추출 (#93)", () => {
  it("법령 인용과 섞인 문장에서 사건번호를 뽑는다", () => {
    expect(extractCaseNumbers("민법 제999조의9와 대법원 2099다99999 판결에 따르면 가능하다."))
      .toEqual(["2099다99999"])
  })

  it("표준 판결 인용 표기를 받는다", () => {
    expect(extractCaseNumbers("대법원 2018. 10. 30. 선고 2013다61381 전원합의체 판결"))
      .toEqual(["2013다61381"])
    expect(extractCaseNumbers("96누4671, 2010두28604")).toEqual(["96누4671", "2010두28604"])
    expect(extractCaseNumbers("헌재 2024헌바107")).toEqual(["2024헌바107"])
  })

  // 적대적 리뷰 지적: 연도·부호·번호 사이 공백을 허용하면 평범한 산문이 사건번호가 되고,
  // 그 토큰이 미래연도 판정에 들어가 인용 없는 문서에 환각 배너가 붙는다.
  it("공백이 낀 산문을 사건번호로 만들지 않는다", () => {
    expect(extractCaseNumbers("2027 예산 500억원을 편성하기로 하였다.")).toEqual([])
    expect(extractCaseNumbers("본 계약의 이행기간은 2027 회계 3분기까지로 한다.")).toEqual([])
    expect(extractCaseNumbers("본 사업은 2030 서울 100주년 기념사업으로 추진한다.")).toEqual([])
    expect(extractCaseNumbers("위 사업은 2028 착공 2032 준공 예정이다.")).toEqual([])
  })

  // 자기리뷰 지적: 부호를 음절 블랙리스트로 거르면 실존 부호를 조용히 놓친다.
  // 회생(회합·회단)·가정보호(호)는 실존 사건부호이므로 제외 대상이 아니다.
  it("회생·가정보호 등 덜 흔한 사건부호도 놓치지 않는다", () => {
    expect(extractCaseNumbers("서울회생법원 2019회단100123 결정")).toEqual(["2019회단100123"])
    expect(extractCaseNumbers("서울회생법원 2020회합100 결정")).toEqual(["2020회합100"])
    // 보호사건 부호는 너(가정보호)·버(아동보호)다. 이전 판에서 '호'를 가정보호로
    // 적었으나 근거 없는 단정이었다 — 실재 부호만 남긴다.
    expect(extractCaseNumbers("2019너1234")).toEqual(["2019너1234"])
    expect(extractCaseNumbers("1988다카12345")).toEqual(["1988다카12345"])
    expect(extractCaseNumbers("2020즈합50")).toEqual(["2020즈합50"])
    // 3음절 부호·개인회생 — 구 정규식이 뽑던 것을 새 정규식도 뽑아야 한다
    expect(extractCaseNumbers("2023개회100001")).toEqual(["2023개회100001"])
    expect(extractCaseNumbers("2022개확1000")).toEqual(["2022개확1000"])
    expect(extractCaseNumbers("2021재고합10")).toEqual(["2021재고합10"])
  })

  it("조문 인용을 사건번호로 오인하지 않는다", () => {
    expect(extractCaseNumbers("민법 제999조의9")).toEqual([])
    expect(extractCaseNumbers("민법 제103조 제1항 제2호")).toEqual([])
    expect(extractCaseNumbers("상법 제401조의2 제2항 제3호")).toEqual([])
  })

  it("연도·날짜·수량 표기를 사건번호로 오인하지 않는다", () => {
    expect(extractCaseNumbers("2023. 5. 10. 시행")).toEqual([])
    expect(extractCaseNumbers("1970년대 30명")).toEqual([])
    expect(extractCaseNumbers("총 20건 3개")).toEqual([])
    expect(extractCaseNumbers("제3회 대회 20명")).toEqual([])
    expect(extractCaseNumbers("판례집 20-2, 300쪽")).toEqual([])
  })

  it("수량 표기 뒤에 오는 진짜 사건번호는 살린다", () => {
    expect(extractCaseNumbers("2024년 2013다61381 판결")).toEqual(["2013다61381"])
  })

  // #137: 블랙리스트만으로는 산문의 숫자+한글+숫자가 사건번호가 된다. ✗ 단정까지는
  // 안 가도 "판례 인용 N건"을 지어내고, 5건 상한을 소진해 진짜 인용을 ⊘로 밀어낸다.
  it("사건부호가 아닌 산문 토큰을 사건번호로 만들지 않는다", () => {
    expect(extractCaseNumbers("계약금은 1000억원2024 기준")).toEqual([])
    expect(extractCaseNumbers("납품수량 2000개2025 예정")).toEqual([])
    expect(extractCaseNumbers("ISO 9001인증2020 취득")).toEqual([])
    expect(extractCaseNumbers("공사비 300만원2023 집행")).toEqual([])
  })

  it("쓰레기 토큰이 진짜 인용의 확인 상한을 잡아먹지 않는다", () => {
    const text = "1000억원2024, 2000개2025, 9001인증2020, 300만원2023, 500건2022 그리고 2013다61381"
    expect(extractCaseNumbers(text)).toEqual(["2013다61381"])
  })

  it("중복은 1회만", () => {
    expect(extractCaseNumbers("2013다61381 및 2013다61381")).toEqual(["2013다61381"])
  })
})

describe("isImpossibleCaseNumber — 구조적으로 불가능한 사건번호", () => {
  it("미래 연도 사건번호는 실존 불가", () => {
    expect(isImpossibleCaseNumber("2099다99999", 2026)).toBe(true)
  })

  it("과거·현재 연도는 판단하지 않는다", () => {
    expect(isImpossibleCaseNumber("2013다61381", 2026)).toBe(false)
    expect(isImpossibleCaseNumber("2026다1", 2026)).toBe(false)
    expect(isImpossibleCaseNumber("96누4671", 2026)).toBe(false)
  })

  // ✗는 "지어낸 인용"이라는 단정이다. 휴리스틱으로 뽑힌 토큰에까지 붙이면
  // 인용이 없는 문서에 환각 배너가 달린다 — 부호가 실재할 때만 단정한다.
  it("실재하지 않는 사건부호에는 부존재를 단정하지 않는다", () => {
    expect(isImpossibleCaseNumber("2027예산500", 2026)).toBe(false)
    expect(isImpossibleCaseNumber("2030서울100", 2026)).toBe(false)
    expect(isImpossibleCaseNumber("2027회계3", 2026)).toBe(false)
  })
})

describe("verifyCaseCitations — 실존 확인", () => {
  const xml = (caseNo: string) => `<?xml version="1.0" encoding="UTF-8"?><PrecSearch>` +
    `<totalCnt>1</totalCnt><page>1</page><prec><판례일련번호>1</판례일련번호>` +
    `<사건명><![CDATA[손해배상(기)]]></사건명><사건번호>${caseNo}</사건번호>` +
    `<법원명>대법원</법원명><선고일자>20181030</선고일자></prec></PrecSearch>`

  // nb=는 업스트림 전방 일치다. 부분 포함으로 받아주면 한 자리 틀린 환각 인용이
  // 실존 판결의 법원·선고일을 달고 ✓로 통과한다.
  it("전방 일치로 돌아온 이웃 사건번호를 실존 근거로 삼지 않는다", async () => {
    const client = { fetchApi: async () => xml("2013다61381") } as unknown as LawApiClient
    const r = await verifyCaseCitations(client, "대법원 2013다6138 판결 참조.")
    expect(r.ok).toBe(0)
    expect(r.unknown).toBe(1)
    expect(r.lines[0]).toContain("미확인")
  })

  it("정확히 일치할 때만 실존으로 인정한다", async () => {
    const client = { fetchApi: async () => xml("2013다61381") } as unknown as LawApiClient
    const r = await verifyCaseCitations(client, "대법원 2013다61381 판결 참조.")
    expect(r.ok).toBe(1)
  })

  it("한 필드에 여러 사건번호가 붙어 와도 개별 일치로 본다", async () => {
    const client = { fetchApi: async () => xml("2017다360, 2017다377") } as unknown as LawApiClient
    expect((await verifyCaseCitations(client, "2017다377 참조.")).ok).toBe(1)
    expect((await verifyCaseCitations(client, "2017다37 참조.")).ok).toBe(0)
  })

  it("상한을 넘긴 인용은 미검증임을 밝힌다", async () => {
    const client = { fetchApi: async () => xml("없음") } as unknown as LawApiClient
    const r = await verifyCaseCitations(
      client,
      "2013다61381, 2014다1111, 2015다2222, 2016다3333, 2017다4444, 2099다99999 참조."
    )
    expect(r.skipped).toBe(1)
    expect(r.lines.join("\n")).toContain("2099다99999")
    expect(r.lines.join("\n")).toContain("미검증")
  })
})
