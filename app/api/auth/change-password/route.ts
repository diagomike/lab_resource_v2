import { NextResponse, type NextRequest } from "next/server";
import { ChangePasswordInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, SESSION_COOKIE } from "@/lib/server/auth/session";
import { changePassword } from "@/lib/server/auth/auth";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(ChangePasswordInput, request);
    await changePassword(user.id, body.currentPassword, body.newPassword, request.cookies.get(SESSION_COOKIE)?.value);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
