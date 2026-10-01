import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/server/auth/session";

export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  if (!hasSessionCookie) {
    // Sign in, then come back to exactly what was asked for (an emailed link, a bookmark).
    const login = new URL("/login", request.url);
    const { pathname, search } = request.nextUrl;
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
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
