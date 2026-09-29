import { describe, expect, it } from "vitest";
import { cleanFileName, sniffDocument } from "./attachment-sniff";

/** Pure: what a purchase-request attachment really is, from its bytes. */

const pdf = (body = "1 0 obj << >> endobj\n") => Buffer.from(`%PDF-1.7\n${body}trailer << >>\n%%EOF\n`, "latin1");
const zip = (...names: string[]) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(names.join("\0"), "latin1")]);
const png = () => {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(800, 16);
  b.writeUInt32BE(600, 20);
  return b;
};

describe("sniffDocument", () => {
  it("accepts a PDF and refuses one cut off before its end marker", () => {
    expect(sniffDocument(pdf())).toEqual({ ok: true, doc: { kind: "PDF", contentType: "application/pdf", ext: "pdf" } });
    const truncated = pdf().subarray(0, 20);
    expect(sniffDocument(truncated)).toEqual({ ok: false, reason: "DAMAGED_PDF" });
  });

  it("accepts an image by its bytes, whatever the file is called", () => {
    const r = sniffDocument(png());
    expect(r.ok && r.doc.kind).toBe("IMAGE");
  });

  it("accepts an .xlsx workbook and refuses macro-enabled, binary and legacy ones", () => {
    const ok = sniffDocument(zip("[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"));
    expect(ok.ok && ok.doc.kind).toBe("SPREADSHEET");
    expect(sniffDocument(zip("xl/workbook.xml", "xl/vbaProject.bin"))).toEqual({ ok: false, reason: "MACRO_WORKBOOK" });
    expect(sniffDocument(zip("xl/workbook.bin"))).toEqual({ ok: false, reason: "MACRO_WORKBOOK" });
    expect(sniffDocument(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toEqual({ ok: false, reason: "LEGACY_OFFICE" });
  });

  it("refuses other ZIPs (a Word document), HTML and SVG", () => {
    expect(sniffDocument(zip("[Content_Types].xml", "word/document.xml"))).toEqual({ ok: false, reason: "UNRECOGNIZED" });
    expect(sniffDocument(Buffer.from("<html><script>alert(1)</script></html>"))).toEqual({ ok: false, reason: "UNRECOGNIZED" });
    expect(sniffDocument(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ ok: false, reason: "UNRECOGNIZED" });
  });
});

describe("cleanFileName", () => {
  it("keeps the last path segment and forces the real extension", () => {
    expect(cleanFileName("C:\\Users\\head\\Desktop\\Minutes 12.pdf", "pdf")).toBe("Minutes 12.pdf");
    expect(cleanFileName("letter.pdf", "jpg")).toBe("letter.jpg");
    expect(cleanFileName("budget", "xlsx")).toBe("budget.xlsx");
  });

  it("drops characters that can't be saved or would break a header, and keeps other scripts", () => {
    expect(cleanFileName('a"b<c>d:e|f?g*h.pdf', "pdf")).toBe("abcdefgh.pdf");
    expect(cleanFileName("ደብዳቤ ቁ. 45.pdf", "pdf")).toBe("ደብዳቤ ቁ. 45.pdf");
    expect(cleanFileName("../../etc/passwd", "pdf")).toBe("passwd.pdf");
  });

  it("falls back to 'document' and caps long names", () => {
    expect(cleanFileName("", "pdf")).toBe("document.pdf");
    expect(cleanFileName(null, "pdf")).toBe("document.pdf");
    expect(cleanFileName(".pdf", "pdf")).toBe("document.pdf");
    expect(cleanFileName(`${"x".repeat(300)}.pdf`, "pdf")).toBe(`${"x".repeat(100)}.pdf`);
  });
});
