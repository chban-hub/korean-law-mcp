import { describe, expect, it } from "vitest"
import { isDownloadNoticeOnly, parseAnnexFile } from "./annex-file-parser.js"

/** Construct a tiny valid text PDF without adding a PDF-generation dependency. */
function minimalPdf(text: string): ArrayBuffer {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET\n`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ]

  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  const bytes = new TextEncoder().encode(pdf)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe("annex file parser", () => {
  it("parses a text PDF when the optional native dependency graph is omitted", async () => {
    const result = await parseAnnexFile(minimalPdf("Annex parser smoke test"))
    expect(result.fileType).toBe("pdf")
    expect(result.success).toBe(true)
    expect(result.markdown).toContain("Annex parser smoke test")
  })
})

// 실측(관세법 별표 000000 관세율표, 2026-08-16): HWP에 내용이 인라인되지 않고
// 다운로드 아이콘으로만 임베드된 별표. 파서는 success를 주지만 본문은 없다(#91).
const DOWNLOAD_ONLY = `■ 관세법 [별표] <개정 2022. 12. 31.>

<u>관세율표(제50조 관련)</u>

별표 의 자세한 내용은 별표 제목 오른쪽 한글 아이콘()을 클릭한 후 [다운로드]를 클릭하시거나 아래 주소를 복사하여 주소창에 입력하십시오.


![image](image_001.bmp)

http://www.law.go.kr/BYL/grtFile/law0015562022123119186KC\\_000000E.hwp

[[다운로드](http://www.law.go.kr/BYL/grtFile/law0015562022123119186KC_000000E.hwp)]`

describe("isDownloadNoticeOnly (#91)", () => {
  it("다운로드 안내만 남은 별표를 본문 미추출로 판정한다", () => {
    expect(isDownloadNoticeOnly(DOWNLOAD_ONLY)).toBe(true)
  })

  it("내용이 추출된 별표는 판정하지 않는다", () => {
    const real = `■ 도로교통법 시행규칙 [별표 28]\n\n운전면허 취소·정지처분 기준\n\n` +
      `| 위반사항 | 벌점 |\n| --- | --- |\n` +
      Array.from({ length: 40 }, (_, i) => `| 위반행위 ${i} 상세 기재 | ${i * 5} |`).join("\n")
    expect(isDownloadNoticeOnly(real)).toBe(false)
  })

  it("짧아도 안내문구가 없으면 정상 별표로 본다 (오탐 방지)", () => {
    const shortReal = `■ 여권법 시행령 [별표]\n\n수수료(제39조 관련)\n\n1. 일반여권 10년 53,000원\n2. 단수여권 20,000원`
    expect(isDownloadNoticeOnly(shortReal)).toBe(false)
  })
})
