import { describe, expect, it } from "vitest";
import { sniffImage } from "./image-sniff";

/** A minimal-but-real PNG header — signature + an IHDR chunk naming 3×2. My sniffer
 *  never checks the CRC or any chunk after IHDR, so this is deliberately not a
 *  decodable image, only a well-formed enough header for the detector to read. */
function pngBytes(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); // IHDR length (unread by the sniffer, present for realism)
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** SOI + a bare SOF0 segment naming width×height — enough for the sniffer, not a
 *  decodable JPEG (no quantization/Huffman tables, no scan data). */
function jpegBytes(width: number, height: number): Buffer {
  const b = Buffer.alloc(12);
  b[0] = 0xff;
  b[1] = 0xd8; // SOI
  b[2] = 0xff;
  b[3] = 0xc0; // SOF0
  b.writeUInt16BE(8, 4); // segment length
  b[6] = 0x08; // precision
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  b[11] = 0x01; // numComponents placeholder
  return b;
}

/** RIFF/WEBP with a VP8X chunk naming a canvas width×height. */
function webpBytes(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii");
  b.writeUInt32LE(10, 16);
  b[20] = 0; // flags
  // bytes 21-23 reserved, left zero
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

describe("sniffImage", () => {
  it("detects a PNG and reads its real dimensions", () => {
    expect(sniffImage(pngBytes(320, 200))).toEqual({ format: "PNG", mimeType: "image/png", width: 320, height: 200 });
  });

  it("detects a JPEG via its SOF0 segment", () => {
    expect(sniffImage(jpegBytes(3, 2))).toEqual({ format: "JPEG", mimeType: "image/jpeg", width: 3, height: 2 });
  });

  it("detects a WebP (VP8X) and reads the canvas dimensions", () => {
    expect(sniffImage(webpBytes(5, 4))).toEqual({ format: "WEBP", mimeType: "image/webp", width: 5, height: 4 });
  });

  it("rejects an SVG outright — its bytes never match any accepted binary signature", () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "utf8");
    expect(sniffImage(svg)).toBeNull();
  });

  it("rejects plain garbage bytes", () => {
    expect(sniffImage(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it("rejects a truncated PNG (signature only, no IHDR)", () => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImage(sig)).toBeNull();
  });

  it("rejects a JPEG whose SOI is never followed by a frame header", () => {
    const b = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // SOI immediately followed by EOI
    expect(sniffImage(b)).toBeNull();
  });

  it("does not trust a claimed Content-Type — a PNG's dimensions come from its own bytes regardless of what a caller declares", () => {
    // (documented via the return shape itself: format/mimeType are DERIVED from the
    // bytes, never accepted as a parameter — this test just pins the contract.)
    const png = pngBytes(1, 1);
    const result = sniffImage(png);
    expect(result?.format).toBe("PNG");
  });
});
