import { describe, expect, it } from "vitest"
import { parseAnnexFile } from "./annex-file-parser.js"

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
