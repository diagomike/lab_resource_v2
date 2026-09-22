import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { setTemporaryPassword } from "@/lib/server/people/people";

const MANAGERIAL = ["SYS_ADMIN", "MANAGER"] as const;

type Params = { params: Promise<{ id: string }> };

/** Returns the temporary password exactly once; it is never stored in plain text. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, [...MANAGERIAL]);
    const { id } = await params;
    const result = await setTemporaryPassword(user.id, user.roles, id);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
