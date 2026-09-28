import { NextResponse, type NextRequest } from "next/server";
import { ExternalSignupInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { hashIp } from "@/lib/server/auth/token";
import { signUp } from "@/lib/server/auth/external-account";

/** No session — an outside institution creates its requester account; a link to confirm
 *  the email address goes out, and sign-in works once it is followed. */
export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(ExternalSignupInput, request);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || undefined;
    await signUp(body, hashIp(ip));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
