/**
 * Real file-type detection from bytes — the server-side half of "do not accept SVG
 * or trust client-supplied metadata as proof of file type." A browser's declared
 * `Content-Type` (or a filename extension) is a claim, not a fact; this module reads
 * the actual magic bytes and, for the three formats this app accepts, the actual
 * pixel dimensions encoded in the file — an SVG (or anything else that isn't one of
 * these three binary formats) fails the very first signature check and is refused
 * before a single format-specific byte is interpreted.
 *
 * Deliberately dependency-free: three formats, each a few fixed byte offsets, no
 * native image library needed since nothing here decodes pixels or resizes anything
 * — only the container header is read. Returns `null` for anything unrecognized or
 * truncated rather than throwing, so a caller's "reject" path is just `if (!sniffed)`.
 */

export type SniffedImageFormat = "PNG" | "JPEG" | "WEBP";

export interface SniffedImage {
  format: SniffedImageFormat;
  mimeType: string;
  width: number;
  height: number;
}

const MIME_FOR: Record<SniffedImageFormat, string> = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
};

function sniffPng(bytes: Buffer): SniffedImage | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  // bytes[12..16) is the "IHDR" chunk type — the first chunk in a well-formed PNG.
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height) return null;
  return { format: "PNG", mimeType: MIME_FOR.PNG, width, height };
}

/** SOF markers (Start Of Frame) carry the dimensions — 0xC0–0xCF minus DHT(C4)/JPG(C8)/
 *  DAC(CC), which share the numeric range but are not frame headers. */
function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function sniffJpeg(bytes: Buffer): SniffedImage | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    // Fill bytes between markers.
    let marker = bytes[i + 1];
    let j = i + 1;
    while (marker === 0xff && j + 1 < bytes.length) {
      j++;
      marker = bytes[j];
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = j + 1;
      continue;
    }
    if (marker === 0xda) return null; // Start of scan — no SOF seen before the compressed data.
    if (j + 3 >= bytes.length) return null;
    const segmentLength = bytes.readUInt16BE(j + 1); // includes these 2 length bytes
    if (isSofMarker(marker)) {
      if (j + 1 + 7 > bytes.length) return null;
      const height = bytes.readUInt16BE(j + 4);
      const width = bytes.readUInt16BE(j + 6);
      if (!width || !height) return null;
      return { format: "JPEG", mimeType: MIME_FOR.JPEG, width, height };
    }
    i = j + 1 + segmentLength;
  }
  return null;
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function sniffWebp(bytes: Buffer): SniffedImage | null {
  if (bytes.length < 30) return null;
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("ascii", 12, 16);

  if (chunk === "VP8X") {
    const width = readUInt24LE(bytes, 24) + 1;
    const height = readUInt24LE(bytes, 27) + 1;
    if (!width || !height) return null;
    return { format: "WEBP", mimeType: MIME_FOR.WEBP, width, height };
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = bytes.readUInt16LE(26) & 0x3fff;
    const height = bytes.readUInt16LE(28) & 0x3fff;
    if (!width || !height) return null;
    return { format: "WEBP", mimeType: MIME_FOR.WEBP, width, height };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const packed = bytes.readUInt32LE(21);
    const width = (packed & 0x3fff) + 1;
    const height = ((packed >> 14) & 0x3fff) + 1;
    if (!width || !height) return null;
    return { format: "WEBP", mimeType: MIME_FOR.WEBP, width, height };
  }
  return null;
}

/** Tries each supported format's signature in turn. A file matching none of them —
 *  including any SVG, since an SVG's bytes start with `<?xml`/`<svg`, never any of
 *  these binary signatures — returns `null`. */
export function sniffImage(bytes: Buffer): SniffedImage | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffWebp(bytes);
}
