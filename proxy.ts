import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/auth/session";

export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

// `help/` (with the slash) is the guide's static content and screenshots in public/help —
// not the /help page, which stays behind sign-in. Matching them here sent every
// screenshot through this function and redirected it to /login when signed out, so the
// CDN could never cache them.
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|help/|login|forgot-password|reset-password|accept-invite|portal).*)",
  ],
};
