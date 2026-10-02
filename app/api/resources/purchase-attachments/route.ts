import { NextResponse, type NextRequest } from "next/server";
import { ATTACHMENT_LIMITS, type PurchaseAttachmentDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { formatBytes, stage } from "@/lib/server/resources/purchase-attachments";

/**
 * Uploads one document for a purchase request, before the submission or decision it
 * goes with — the body is the file's raw bytes (never multipart or JSON), `?name=` the
 * file's name. It is held STAGED for its uploader until an action sends it
 * (`attachmentIds` on submit, resubmit, decide or cancel). What it really is, and
 * whether it fits, is decided from the bytes (lib/server/resources/purchase-attachments.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);

    // Refused before a byte is read when the declared size is already over.
    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > ATTACHMENT_LIMITS.fileBytes) {
      throw new HttpError(400, `That file is ${formatBytes(declaredLength)}: the limit is ${formatBytes(ATTACHMENT_LIMITS.fileBytes)} a file.`);
    }

    const bytes = Buffer.from(await request.arrayBuffer());
    const result = await stage(user.id, request.nextUrl.searchParams.get("name"), bytes);
    return NextResponse.json<PurchaseAttachmentDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
