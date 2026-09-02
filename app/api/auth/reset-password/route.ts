import { NextResponse, type NextRequest } from "next/server";
import { ResetPasswordInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { resetPassword } from "@/lib/server/auth/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(ResetPasswordInput, request);
    await resetPassword(body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
