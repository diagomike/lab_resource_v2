import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { SESSION_COOKIE, clearSessionCookie } from "@/lib/server/auth/session";
import { logout } from "@/lib/server/auth/auth";

export async function POST(request: NextRequest) {
  try {
    await logout(request.cookies.get(SESSION_COOKIE)?.value);
    // Matches the recorded reference: 201, empty body.
    const response = new NextResponse(null, { status: 201 });
    clearSessionCookie(response);
    return response;
  } catch (err) {
    return errorResponse(err);
  }
}
