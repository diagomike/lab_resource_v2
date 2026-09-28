import { NextResponse, type NextRequest } from "next/server";
import { VerifyEmailInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { verifyEmail } from "@/lib/server/auth/external-account";

/** No session — the emailed confirmation link activates a requester account. */
export async function POST(request: NextRequest) {
  try {
    const { token } = await parseBody(VerifyEmailInput, request);
    return NextResponse.json(await verifyEmail(token), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
