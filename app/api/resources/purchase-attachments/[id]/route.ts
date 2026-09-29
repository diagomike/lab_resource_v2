import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { assertCanReadRequest } from "@/lib/server/resources/purchasing";
import { discard, findForServing, readBytes } from "@/lib/server/resources/purchase-attachments";

type Params = { params: Promise<{ id: string }> };

/** `filename*` (RFC 6266/5987) carries a name in any script — Amharic included — and the
 *  plain `filename` an ASCII fallback for anything that ignores it. */
function disposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Serves one document. Holding the link is not permission: a staged file is readable
 * only by its uploader, an attached one by whoever may follow its request
 * (`assertCanReadRequest`) — anyone else gets the same 404 as a file that doesn't
 * exist. PDFs and images open in the browser; a workbook downloads.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;

    const found = await findForServing(id);
    if (!found) throw new HttpError(404, "File not found");
    if (found.status === "STAGED" || !found.purchaseId) {
      if (found.uploadedById !== user.id) throw new HttpError(404, "File not found");
    } else {
      await assertCanReadRequest(user.id, found.purchaseId).catch(() => {
        throw new HttpError(404, "File not found");
      });
    }

    const bytes = await readBytes(found.storageKey);
    if (!bytes) throw new HttpError(404, "File not found");

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": found.contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": disposition(found.kind === "SPREADSHEET" ? "attachment" : "inline", found.fileName),
        // The type came from the bytes; the browser must not second-guess it.
        "X-Content-Type-Options": "nosniff",
        // A stored document never changes. `private`: the check above is per person.
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The uploader removes a file they haven't sent yet. A sent file is part of the
 *  request's record and stays. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    await discard(user.id, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
