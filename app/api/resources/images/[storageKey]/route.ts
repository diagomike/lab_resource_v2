import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { assertCanSeeItem } from "@/lib/server/resources/scope";
import { findImageForServing } from "@/lib/server/resources/images";
import { storage } from "@/lib/server/resources/storage";
import { sniffImage } from "@/lib/server/resources/image-sniff";

type Params = { params: Promise<{ storageKey: string }> };

/**
 * Serves one image's bytes. Possessing the URL is deliberately NOT authorization —
 * every request re-resolves the storage key back to the item it belongs to and runs
 * the exact same read-scope check (`assertCanSeeItem`, ancestor-inclusive) a direct
 * item read would, so a signed-out request, a guessed key, or a key copied out of one
 * department's response into another department's session all fail the same way an
 * out-of-scope item read already does — 404, not a broken-but-revealing 403.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { storageKey } = await params;

    const found = await findImageForServing(storageKey);
    if (!found) throw new HttpError(404, "Photo not found");

    let contentType = found.contentType;
    if (found.scope === "item") {
      await assertCanSeeItem(user.id, found.itemId);
    }
    // A category's default image is shared vocabulary — readable by anyone signed in,
    // same as the category itself; no per-item scope check applies to it.

    const bytes = await storage.read(storageKey);
    if (!bytes) throw new HttpError(404, "Photo not found");

    if (!contentType) {
      contentType = sniffImage(bytes)?.mimeType ?? "application/octet-stream";
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
