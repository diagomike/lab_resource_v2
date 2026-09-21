import { NextResponse, type NextRequest } from "next/server";
import { SubmitExternalRequestInput, type SubmitExternalRequestResultDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { hashIp } from "@/lib/server/auth/token";
import { MAX_LETTER_BYTES, submitRequest } from "@/lib/server/external/requests";

/**
 * No session — an outside institution submits a request. Multipart: `payload` (the
 * JSON described by SubmitExternalRequestInput) and `letter` (the official letter, a PDF
 * checked by its bytes). Throttled per email and per IP; the tracking token comes back
 * once, here and in the confirmation email.
 */
export async function POST(request: NextRequest) {
  try {
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_LETTER_BYTES + 200_000) throw new HttpError(400, "The letter must be a PDF of at most 4 MB.");

    const form = await request.formData().catch(() => null);
    if (!form) throw new HttpError(400, "Send the request as a form with a letter attached.");
    const letter = form.get("letter");
    if (!(letter instanceof File) || letter.size === 0) throw new HttpError(400, "Attach the official letter as a PDF.");

    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get("payload") ?? ""));
    } catch {
      throw new HttpError(400, "The request details could not be read.");
    }
    const parsed = SubmitExternalRequestInput.safeParse(payload);
    if (!parsed.success) throw new HttpError(400, "Validation failed", { message: parsed.error.issues[0]?.message ?? "Validation failed", issues: parsed.error.issues });

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
    const result = await submitRequest(parsed.data, { bytes: Buffer.from(await letter.arrayBuffer()), fileName: letter.name }, hashIp(ip));
    return NextResponse.json<SubmitExternalRequestResultDto>(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
