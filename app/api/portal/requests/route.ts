import { NextResponse, type NextRequest } from "next/server";
import { SubmitExternalRequestInput, type RequesterRequestSummaryDto, type SubmitExternalRequestResultDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireRole, requireSession } from "@/lib/server/auth/session";
import { hashIp } from "@/lib/server/auth/token";
import { MAX_LETTER_BYTES, listForRequester, submitRequest } from "@/lib/server/external/requests";
import { readableIssues } from "@/lib/shared/validation-message";

/**
 * The signed-in requester's own requests. GET lists them; POST sends a new one —
 * multipart: `payload` (SubmitExternalRequestInput as JSON) and `letter` (the official
 * letter, a PDF checked by its bytes). Throttled per account and per IP.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["EXTERNAL"]);
    return NextResponse.json<RequesterRequestSummaryDto[]>(await listForRequester(user.id), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["EXTERNAL"]);
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_LETTER_BYTES + 200_000) throw new HttpError(400, "The letter must be a PDF of at most 4 MB.");

    const form = await request.formData().catch(() => null);
    if (!form) throw new HttpError(400, "Send the request as a form with a letter attached.");
    const letter = form.get("letter");
    const attached = letter instanceof File && letter.size > 0 ? letter : null;

    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get("payload") ?? ""));
    } catch {
      throw new HttpError(400, "The request details could not be read.");
    }
    const parsed = SubmitExternalRequestInput.safeParse(payload);
    if (!parsed.success) {
      const message = readableIssues(parsed.error.issues);
      throw new HttpError(400, message, { message, issues: parsed.error.issues });
    }

    // A request sent again keeps its letter unless a new one is attached.
    if (!attached && !parsed.data.resubmitOf) throw new HttpError(400, "Attach the official letter as a PDF.");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
    const result = await submitRequest(user.id, parsed.data, attached ? { bytes: Buffer.from(await attached.arrayBuffer()), fileName: attached.name } : null, hashIp(ip));
    return NextResponse.json<SubmitExternalRequestResultDto>(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
