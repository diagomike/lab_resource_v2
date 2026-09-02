import { NextResponse, type NextRequest } from "next/server";
import { LoginInput, type SessionUserDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { setSessionCookie } from "@/lib/server/auth/session";
import { login } from "@/lib/server/auth/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(LoginInput, request);
    const { token, user } = await login(body, {
      ip: request.headers.get("x-forwarded-for") ?? undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    // Matches the recorded reference: a successful POST returns 201, NestJS's default.
    const response = NextResponse.json<SessionUserDto>(user, { status: 201 });
    setSessionCookie(response, token);
    return response;
  } catch (err) {
    return errorResponse(err);
  }
}
