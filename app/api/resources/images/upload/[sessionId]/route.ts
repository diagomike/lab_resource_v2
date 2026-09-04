import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { MAX_UPLOAD_BYTES, receiveUpload } from "@/lib/server/resources/images";

type Params = { params: Promise<{ sessionId: string }> };

/**
 * Step 2 — receives the actual bytes for a session `createUploadSession` already
 * authorized. The request's `Content-Type` header is read only as a cheap early-exit
 * hint; `receiveUpload` never trusts it — the stored `contentType` always comes from
 * sniffing the bytes themselves (lib/server/resources/image-sniff.ts).
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { sessionId } = await params;

    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      throw new HttpError(400, `That file is too large — the limit is ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
    }

    const buffer = Buffer.from(await request.arrayBuffer());
    const result = await receiveUpload(user.id, sessionId, buffer);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
