/**
 * get_annexes Tool - 별표/서식 조회 + 텍스트 추출
 */

import { z } from "zod"
import type { LawApiClient } from "../lib/api-client.js"
import { fetchWithRetry } from "../lib/fetch-with-retry.js"
import { readResponseArrayBuffer } from "../lib/response-body.js"
import { isDownloadNoticeOnly, parseAnnexFile } from "../lib/annex-file-parser.js"
import { truncateResponse, MAX_RESPONSE_SIZE } from "../lib/schemas.js"
import { formatToolError, notFoundResponse } from "../lib/errors.js"
import { getLawSiteBaseUrl } from "../lib/law-url-config.js"
import { fetchLawAnnexUnits, findMissingUnits, pickAnnexUnit } from "../lib/annex-canonical.js"
import { parseLawNameAndHint } from "../lib/annex-notation.js"
import {
  buildSelectorCandidates, extractBundledSection, extractParentLawName, extractSelectorNumbers,
  filterByAnnexQuery, filterByRelatedLawName, findMatchingAnnex, isBundledAnnex,
  type AnnexItem,
} from "./annex-select.js"

const LAW_BASE_URL = getLawSiteBaseUrl()

export const GetAnnexesSchema = z.object({
  lawName: z.string().describe("법령명 (예: '관세법'). 별표를 바로 지정하려면 '... 별표4' 또는 '... 별표1의2'처럼 함께 입력 가능"),
  knd: z.enum(["1", "2", "3", "4", "5"]).optional().describe("1=별표, 2=서식, 3=부칙별표, 4=부칙서식, 5=전체"),
  bylSeq: z.string().optional().describe("별표번호 (예: '000300'). 지정 시 해당 별표 파일을 다운로드하여 텍스트로 추출"),
  annexNo: z.string().optional().describe("별표 번호 (예: '4', '별표4', '제4호'). bylSeq 대체 입력"),
  query: z.string().optional().describe("별표명으로 좁히기 (예: '운전면허 취소·정지', '과태료'). 번호를 모를 때 사용. 1건으로 좁혀지면 그 별표 본문을 바로 추출"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetAnnexesInput = z.infer<typeof GetAnnexesSchema>

export async function getAnnexes(
  apiClient: LawApiClient,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const parsedLawInput = parseLawNameAndHint(input.lawName)
    const normalizedLawName = parsedLawInput.normalizedLawName || input.lawName
    // query에 "별표28"처럼 번호가 실려오면 그것도 선택값으로 인정한다 (#94)
    const queryHint = input.query ? parseLawNameAndHint(input.query).annexNo : undefined
    const annexSelector = (input.bylSeq || input.annexNo || parsedLawInput.annexNo || queryHint || "").trim()

    let annexList: AnnexItem[] = []
    let lawType: string = "law"

    // 법제처 API는 결과 1건일 때 배열 대신 단일 객체를 반환하므로 정규화
    const toArray = (v: unknown): AnnexItem[] =>
      v == null ? [] : Array.isArray(v) ? v : [v]

    const parseAnnexResponse = (jsonText: string): { list: AnnexItem[], type: string } => {
      try {
        const json = JSON.parse(jsonText)
        const adminResult = json?.admRulBylSearch
        const licResult = json?.licBylSearch
        // 법제처 행정규칙 별표 응답의 배열 키는 admrulbyl (admbyl 아님). 구버전 호환 위해 admbyl도 폴백.
        if (adminResult?.admrulbyl ?? adminResult?.admbyl)
          return { list: toArray(adminResult.admrulbyl ?? adminResult.admbyl), type: "admin" }
        if (licResult?.ordinbyl) return { list: toArray(licResult.ordinbyl), type: "ordinance" }
        if (licResult?.licbyl) return { list: toArray(licResult.licbyl), type: "law" }
        return { list: [], type: "law" }
      } catch {
        // JSON 파싱 실패 (HTML 에러 페이지 등) → 빈 배열 반환하여 fallback 진행
        return { list: [], type: "law" }
      }
    }

    // 1차: 원래 법령명 + knd 필터
    const result1 = parseAnnexResponse(await apiClient.getAnnexes({
      lawName: normalizedLawName, knd: input.knd, apiKey: input.apiKey
    }))
    annexList = result1.list
    lawType = result1.type

    // 2차: 결과 없으면 knd 제거 (법제처가 "별표"를 "서식"으로 분류하는 경우)
    if (annexList.length === 0 && input.knd) {
      const result2 = parseAnnexResponse(await apiClient.getAnnexes({
        lawName: normalizedLawName, apiKey: input.apiKey
      }))
      annexList = result2.list
      lawType = result2.type
    }

    // 3차: 모법명으로 재검색 ("여권법 시행규칙" → "여권법")
    if (annexList.length === 0) {
      const parentName = extractParentLawName(normalizedLawName)
      if (parentName) {
        const result3 = parseAnnexResponse(await apiClient.getAnnexes({
          lawName: parentName, apiKey: input.apiKey
        }))
        // 원래 법령명 매칭 필터
        const filtered = result3.list.filter((a: AnnexItem) => {
          const name = String(a.관련법령명 || a.관련자치법규명 || a.관련행정규칙명 || "").replace(/<[^>]+>/g, "")
          return name === normalizedLawName
        })
        annexList = filtered.length > 0 ? filtered : result3.list
        lawType = result3.type
      }
    }

    // 4차: 행정규칙(고시/훈령/예규) 별표 admin fallback.
    // "사료 등의 기준 및 규격"처럼 제목에 '고시·훈령' 등 종류 키워드가 없는 행정규칙은
    // detectLawType이 'law'로 분류해 licbyl만 조회하고 admbyl 경로를 놓친다(#58).
    // 앞 단계가 모두 비면 종류 무관하게 admbyl로 재조회한다.
    if (annexList.length === 0) {
      try {
        const adminText = await apiClient.fetchApi({
          endpoint: "lawSearch.do",
          target: "admbyl",
          type: "JSON",
          extraParams: {
            query: normalizedLawName,
            search: "2",
            display: "100",
          },
          apiKey: input.apiKey,
        })
        const result4 = parseAnnexResponse(adminText)
        if (result4.list.length > 0) {
          annexList = result4.list
          lawType = "admin"
        }
      } catch {
        // admin fallback 실패 → 무시하고 진행
      }
    }

    if (annexList.length === 0) {
      return notFoundResponse(
        `"${normalizedLawName}"에 대한 별표/서식이 법제처 DB에 없습니다.`,
        [
          "법령명 오탈자 확인 (예: '관세법 시행령' vs '관세법')",
          `search_law({ query: "${normalizedLawName}" }) 로 정확한 법령명 확인`,
          "모법에 별표가 있을 수 있음 (시행규칙 대신 시행령으로 재시도)",
        ]
      )
    }

    // 최신본 우선 정렬
    annexList.sort((a: AnnexItem, b: AnnexItem) =>
      (b.자치법규시행일자 || b.공포일자 || "").localeCompare(a.자치법규시행일자 || a.공포일자 || "")
    )

    // 관련법규명 필터링: 사용자 쿼리와 가장 일치하는 조례 우선
    const filtered = filterByRelatedLawName(annexList, normalizedLawName)

    // 별표 선택값 지정 시 → 해당 별표 파일 다운로드 + 텍스트 추출
    if (annexSelector) {
      return await extractAnnexContent(apiClient, filtered, annexSelector, normalizedLawName, lawType, input)
    }

    // 별표 선택값 미지정 → 목록 반환. 법령은 현행 본문 별표단위와 대조해
    // licbyl 인덱스에 없는 항목(개정 신설 별표 등)을 병합 표시 (#77 후속)
    let listForDisplay = filtered
    let mergeIssue: string | undefined
    if (lawType === "law") {
      const msts = new Set(filtered.map((a) => String(a.관련법령일련번호 || "")))
      const mst = msts.size === 1 ? [...msts][0] : ""
      if (mst) {
        try {
          const units = await fetchLawAnnexUnits(apiClient, mst, input.apiKey)
          const missing = findMissingUnits(filtered, units)
          listForDisplay = [
            ...filtered,
            ...missing.map((u): AnnexItem => ({
              별표번호: u.code6,
              별표명: `${u.title} [현행 본문 신규 — 검색 인덱스 미등재]`,
              별표종류: u.kind,
              별표서식파일링크: u.hwpLink,
              별표서식PDF파일링크: u.pdfLink,
              관련법령명: normalizedLawName,
            })),
          ]
        } catch {
          // 병합 실패를 삼키면 신설 별표가 빠진 목록이 완전한 목록으로 보인다 (#127).
          // 목록 자체는 유효하므로 isError가 아니라 마커로 알린다.
          mergeIssue = "현행 본문 조회 실패"
        }
      } else {
        mergeIssue = "대상 법령일련번호 미확정"
      }
    }

    // query 키워드로 목록을 좁힌다 (#94). 번호를 모르는 호출자에게는 이것이
    // 특정 별표(도로교통법 시행규칙 별표28 등)에 도달하는 유일한 경로이므로,
    // 1건으로 확정되면 목록 대신 본문까지 바로 준다.
    const scoped = filterByAnnexQuery(listForDisplay, input.query)
    const onlySeq = scoped.list.length === 1 ? String(scoped.list[0].별표번호 || "").trim() : ""
    if (scoped.matched && scoped.keywords.length > 0 && onlySeq) {
      return await extractAnnexContent(apiClient, scoped.list, onlySeq, normalizedLawName, lawType, input)
    }
    return formatAnnexList(scoped.list, lawType, input, normalizedLawName, scoped, mergeIssue)
  } catch (error) {
    return formatToolError(error, "get_annexes")
  }
}

// ─── 별표 텍스트 추출 ─────────────────────────────────

async function extractAnnexContent(
  apiClient: LawApiClient,
  annexList: AnnexItem[],
  annexSelector: string,
  normalizedLawName: string,
  lawType: string,
  input: GetAnnexesInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  const knd = input.knd
  // bylSeq / annexNo / lawName 내 힌트로 유연 매칭 (별표/서식 구분 위해 knd 전달)
  let matched = findMatchingAnnex(annexList, annexSelector, knd)

  // 법령은 현행 본문(lawService)의 별표단위 링크를 정본으로 우선 사용 (#77 — licbyl
  // 인덱스가 구본/결함 파일을 가리키거나 신설 별표를 누락하는 사례). 실패 시 licbyl 폴백.
  let canonicalIssue = false
  if (lawType === "law") {
    const mst = matched?.관련법령일련번호 || annexList[0]?.관련법령일련번호
    if (mst) {
      try {
        const units = await fetchLawAnnexUnits(apiClient, String(mst), input.apiKey)
        const unit = pickAnnexUnit(units, {
          code6: matched?.별표번호 ? String(matched.별표번호).trim() : undefined,
          kind: matched?.별표종류 ? String(matched.별표종류) : undefined,
          selectorCandidates: matched ? undefined : buildSelectorCandidates(annexSelector),
          knd,
        })
        if (unit) {
          matched = {
            ...(matched ?? {}),
            별표번호: matched?.별표번호 || unit.code6,
            별표명: matched?.별표명 || unit.title,
            별표종류: matched?.별표종류 || unit.kind,
            별표서식파일링크: unit.hwpLink || matched?.별표서식파일링크,
            별표서식PDF파일링크: unit.pdfLink || matched?.별표서식PDF파일링크,
          }
        }
      } catch {
        // 정본 조회 실패 → licbyl 링크로 진행. 그 링크가 구본을 가리킬 수 있다는
        // 사실을 삼키면 구본 내용이 현행으로 읽힌다 (#127, #77과 같은 손실).
        canonicalIssue = true
      }
    }
  }

  if (!matched) {
    const availableBylSeq = annexList.map((a) => a.별표번호).filter(Boolean).slice(0, 20).join(", ")
    return notFoundResponse(
      `별표 선택값 "${annexSelector}"에 해당하는 항목을 찾을 수 없습니다. (법령: ${normalizedLawName})`,
      [
        `사용 가능한 별표번호(일부): ${availableBylSeq || "없음"}`,
        `예: get_annexes({ lawName: "${normalizedLawName}", bylSeq: "${annexList[0]?.별표번호 || "000100"}" })`,
        `예: get_annexes({ lawName: "${normalizedLawName} 별표4" })`,
      ]
    )
  }

  const annexTitle = matched.별표명 || "제목 없음"
  const fileLink = matched.별표서식파일링크 || matched.별표서식PDF파일링크 || matched.별표파일링크 || ""

  if (!fileLink) {
    return notFoundResponse(
      `"${annexTitle}"의 파일 링크가 법제처 응답에 포함되지 않았습니다.`,
      ["법령 전체 별표 목록을 다시 조회하세요: get_annexes({ lawName: '...' })"]
    )
  }

  // 파일 다운로드
  const downloadUrl = `${LAW_BASE_URL}${fileLink}`
  const response = await fetchWithRetry(downloadUrl, { timeout: 30000 })
  if (!response.ok) {
    return {
      content: [{ type: "text", text: `파일 다운로드 실패: HTTP ${response.status}\nURL: ${downloadUrl}` }],
      isError: true
    }
  }

  const buffer = await readResponseArrayBuffer(response)
  const result = await parseAnnexFile(buffer)

  if (result.fileType === "pdf" && result.isImageBased) {
    // 이미지 기반 PDF: 텍스트 추출 불가 → 링크 안내
    const pdfLink = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `${annexTitle}\n\n이미지 기반 PDF입니다 (${result.pageCount || "?"}페이지). 텍스트 추출이 불가합니다.\n다운로드 링크: ${LAW_BASE_URL}${pdfLink}`
      }]
    }
  }

  if (!result.success || !result.markdown) {
    // 파싱 실패 시에도 PDF 링크 안내
    const fallbackLink = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `"${annexTitle}" 텍스트 추출 실패: ${result.error || "알 수 없는 오류"}\n파일 링크: ${LAW_BASE_URL}${fallbackLink}`
      }],
      isError: true
    }
  }

  // 파싱은 성공했지만 파일에 내용이 없고 다운로드 안내만 담긴 경우 (#91).
  // 그대로 성공 반환하면 호출자가 "내용이 짧은 별표"로 오인해 빈 근거로 답을 만든다.
  if (isDownloadNoticeOnly(result.markdown)) {
    const link = matched.별표서식PDF파일링크 || fileLink
    return {
      content: [{
        type: "text",
        text: `[본문 미추출] ${normalizedLawName} - ${annexTitle}\n\n` +
          `이 별표는 파일에 내용이 인라인돼 있지 않고 다운로드 안내만 들어 있습니다 ` +
          `(파일 형식: ${result.fileType.toUpperCase()}).\n` +
          `⚠️ 별표 본문을 확보하지 못했습니다. 이 응답을 근거로 별표 내용을 서술하지 마세요.\n` +
          `원문 파일: ${LAW_BASE_URL}${link}`
      }],
      isError: true
    }
  }

  // 파싱 성공 - 묶음 별표면 요청 섹션만 추출
  let markdown = result.markdown
  const selectorNumbers = extractSelectorNumbers(annexSelector)
  if (selectorNumbers.length > 0 && isBundledAnnex(annexTitle)) {
    const extracted = extractBundledSection(markdown, selectorNumbers[0])
    if (extracted) markdown = extracted
  }

  const canonicalNote = canonicalIssue
    ? `⚠️ 정본 링크 확인 불가 (현행 본문 조회 실패) — 검색 인덱스(licbyl) 링크로 조회했습니다.\n` +
      `   최신 개정이 반영되지 않은 구본일 수 있습니다.\n`
    : ""
  const header = `${normalizedLawName} - ${annexTitle}\n(파일 형식: ${result.fileType.toUpperCase()}${result.pageCount ? `, ${result.pageCount}페이지` : ""})\n${canonicalNote}\n`
  const fullText = header + markdown
  return {
    content: [{
      type: "text",
      text: truncateResponse(fullText, MAX_RESPONSE_SIZE)
    }]
  }
}

// ─── 목록 포맷 (기존 동작) ────────────────────────────

function formatAnnexList(
  annexList: AnnexItem[],
  lawType: string,
  input: GetAnnexesInput,
  normalizedLawName: string,
  scope?: { keywords: string[], matched: boolean },
  mergeIssue?: string
): { content: Array<{ type: string, text: string }> } {
  const kndLabel = input.knd === "1" ? "별표"
                 : input.knd === "2" ? "서식"
                 : input.knd === "3" ? "부칙별표"
                 : input.knd === "4" ? "부칙서식"
                 : "별표/서식"

  let resultText = `법령명: ${normalizedLawName}\n`
  resultText += `${kndLabel} 목록 (총 ${annexList.length}건`
  if (scope?.keywords.length && scope.matched) {
    resultText += `, query="${scope.keywords.join(" ")}" 적용`
  }
  resultText += `):\n\n`
  // 필터가 0건이면 전체 목록을 주되 그 사실을 밝힌다 — 조용히 전체를 주면
  // "필터가 걸린 결과"로 오인된다(#94가 보고한 증상 그 자체)
  if (scope?.keywords.length && !scope.matched) {
    resultText = `법령명: ${normalizedLawName}\n` +
      `⚠️ query="${scope.keywords.join(" ")}"와 일치하는 별표명이 없어 전체 목록을 표시합니다.\n` +
      `${kndLabel} 목록 (총 ${annexList.length}건):\n\n`
  }

  // 병합 미수행은 목록 맨 앞에 — 20건 표시 상한이나 절단에 밀려 사라지면 안 된다 (#127)
  if (mergeIssue) {
    resultText = `⚠️ 신설 별표 병합 확인 불가 (${mergeIssue}) — 아래는 검색 인덱스(licbyl) 기준 목록이며,\n` +
      `   최근 개정으로 신설된 별표가 빠져 있을 수 있습니다. 찾는 별표가 없으면 법령 본문에서 직접 확인하세요.\n\n` +
      resultText
  }

  const maxItems = Math.min(annexList.length, 20)

  for (let i = 0; i < maxItems; i++) {
    const annex = annexList[i]
    const annexTitle = annex.별표명 || "제목 없음"
    const annexType = annex.별표종류 || ""
    const annexNum = annex.별표번호 || ""

    resultText += `${i + 1}. `
    if (annexNum) resultText += `[${annexNum}] `
    resultText += `${annexTitle}`
    if (annexType) resultText += ` (${annexType})`
    resultText += `\n`

    if (lawType === "ordinance") {
      const relatedLaw = annex.관련자치법규명
      const localGov = annex.지자체기관명
      if (relatedLaw) {
        resultText += `   관련법규: ${relatedLaw.replace(/<[^>]+>/g, '')}\n`
      }
      if (localGov) {
        resultText += `   지자체: ${localGov}\n`
      }
    } else if (lawType === "admin") {
      if (annex.관련행정규칙명) resultText += `   행정규칙: ${annex.관련행정규칙명}\n`
      const dept = annex.소관부처명 || annex.소관부처
      if (dept) resultText += `   소관부처: ${dept}\n`
    } else {
      if (annex.관련법령명) resultText += `   관련법령: ${annex.관련법령명}\n`
    }

    resultText += `\n`
  }

  if (annexList.length > maxItems) {
    resultText += `\n... 외 ${annexList.length - maxItems}개 항목 (생략)\n`
  }

  resultText += `\n[주의] 별표 내용을 확인하려면 이 도구(get_annexes)를 bylSeq 파라미터와 함께 다시 호출하세요.\n예: get_annexes({ lawName: "${normalizedLawName}", bylSeq: "${annexList[0]?.별표번호 || '000100'}" })`
  resultText += `\n커넥터에서 bylSeq 입력이 제한되면 lawName에 별표번호를 함께 넣어 호출할 수 있습니다.\n예: get_annexes({ lawName: "${normalizedLawName} 별표4" })`

  return { content: [{ type: "text", text: truncateResponse(resultText) }] }
}
