import "server-only";
import sharp from "sharp";
import { HttpError } from "../http-error";

/**
 * Every uploaded photo is re-encoded here before it is stored, whatever the browser
 * sent. ItemImages.tsx already shrinks photos client-side, but that is a courtesy: a
 * browser that can't decode the file, an old client or a direct API call would store a
 * phone's full-size original. So the server owns the result:
 *
 *   - turned upright from the camera's EXIF orientation, then ALL metadata dropped
 *     (a phone photo's EXIF carries the GPS position it was taken at);
 *   - fitted inside STORED_MAX_EDGE (never enlarged);
 *   - encoded as WebP, typically 60–200 KB for a 1600px photo.
 *
 * A file that sniffs as an image but will not decode is refused, not stored.
 */
export const STORED_MAX_EDGE = 1600;
const WEBP_QUALITY = 80;

export interface NormalizedImage {
  bytes: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
}

export async function normalizeImage(input: Buffer, maxInputPixels: number): Promise<NormalizedImage> {
  try {
    const { data, info } = await sharp(input, { limitInputPixels: maxInputPixels, failOn: "error" })
      .rotate()
      .resize({ width: STORED_MAX_EDGE, height: STORED_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, contentType: "image/webp", width: info.width, height: info.height };
  } catch {
    throw new HttpError(400, "That image could not be read — it may be damaged. Try saving it again as a JPEG or PNG.");
  }
}
