import { NextResponse, type NextRequest } from "next/server";
import { ForgotPasswordInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { forgotPassword } from "@/lib/server/auth/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(ForgotPasswordInput, request);
    await forgotPassword(body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
