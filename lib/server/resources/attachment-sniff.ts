import { sniffImage, type SniffedImage } from "./image-sniff";

/**
 * What a purchase-request attachment really is, read from its bytes — the browser's
 * Content-Type and the file's extension are claims, not facts (the same rule
 * `image-sniff.ts` applies to photos). Three kinds are accepted:
 *
 *   - PDF: the `%PDF-` header in the first KB (where the spec allows it) and an `%%EOF`
 *     marker near the end, so a scan cut off mid-upload is refused instead of stored
 *     as a file nobody can open;
 *   - an image (JPEG, PNG, WebP — `sniffImage`), a phone photo of a stamped letter;
 *   - an Excel workbook (.xlsx): a ZIP whose entries include `xl/workbook.xml`. A
 *     macro-enabled one (an `xl/vbaProject.bin` entry) is refused, as is the legacy
 *     binary .xls (and any other OLE file, e.g. a password-protected workbook).
 *
 * Dependency-free and pure: ZIP entry names are stored uncompressed in both the local
 * headers and the central directory, so a byte search finds them without unzipping.
 */

export type SniffedDocument =
  | { kind: "PDF"; contentType: "application/pdf"; ext: "pdf" }
  | { kind: "IMAGE"; image: SniffedImage }
  | { kind: "SPREADSHEET"; contentType: typeof XLSX_MIME; ext: "xlsx" };

export type DocumentRefusal = "UNRECOGNIZED" | "DAMAGED_PDF" | "MACRO_WORKBOOK" | "LEGACY_OFFICE";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Buffer, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

export function sniffDocument(bytes: Buffer): { ok: true; doc: SniffedDocument } | { ok: false; reason: DocumentRefusal } {
  const head = bytes.subarray(0, 1024).toString("latin1");
  const pdfAt = head.indexOf("%PDF-");
  if (pdfAt >= 0) {
    // Incremental saves append after the first %%EOF, so the last one sits near the end.
    const tail = bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1");
    if (!tail.includes("%%EOF")) return { ok: false, reason: "DAMAGED_PDF" };
    return { ok: true, doc: { kind: "PDF", contentType: "application/pdf", ext: "pdf" } };
  }

  const image = sniffImage(bytes);
  if (image) return { ok: true, doc: { kind: "IMAGE", image } };

  if (startsWith(bytes, ZIP_MAGIC)) {
    const names = bytes.toString("latin1");
    if (!names.includes("xl/workbook.xml") && !names.includes("xl/workbook.bin")) return { ok: false, reason: "UNRECOGNIZED" };
    if (names.includes("xl/vbaProject.bin") || names.includes("xl/workbook.bin")) return { ok: false, reason: "MACRO_WORKBOOK" };
    return { ok: true, doc: { kind: "SPREADSHEET", contentType: XLSX_MIME, ext: "xlsx" } };
  }

  if (startsWith(bytes, OLE_MAGIC)) return { ok: false, reason: "LEGACY_OFFICE" };
  return { ok: false, reason: "UNRECOGNIZED" };
}

export const REFUSAL_MESSAGE: Record<DocumentRefusal, string> = {
  UNRECOGNIZED: "Attach a PDF, a photo or scan (JPEG, PNG, WebP), or an Excel workbook (.xlsx). That file is none of these.",
  DAMAGED_PDF: "That PDF looks incomplete or damaged. Save or scan it again and attach the new copy.",
  MACRO_WORKBOOK: "Macro-enabled or binary workbooks (.xlsm, .xlsb) aren't accepted. Save it as a plain .xlsx.",
  LEGACY_OFFICE: "Older Office files (.xls, .doc) and password-protected workbooks aren't accepted. Save it as .xlsx or PDF without a password.",
};

/**
 * The name people will see and download: the last path segment of what the browser
 * sent, without characters Windows can't save or that could break a header, at most
 * 100 characters before the extension, and always ending in the extension of what the
 * bytes really are (a scan named "letter.pdf" that is really a JPEG becomes
 * "letter.jpg").
 */
export function cleanFileName(raw: string | null | undefined, ext: string): string {
  let base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  base = base
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const dot = base.lastIndexOf(".");
  if (dot >= 0) base = base.slice(0, dot).trim();
  base = base.replace(/^\.+/, "").slice(0, 100).trim();
  return `${base || "document"}.${ext}`;
}
