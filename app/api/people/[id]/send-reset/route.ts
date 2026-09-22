import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { sendPasswordReset } from "@/lib/server/people/people";

const MANAGERIAL = ["SYS_ADMIN", "MANAGER"] as const;

type Params = { params: Promise<{ id: string }> };

/** Emails the person a reset link — the response never carries the link itself. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, [...MANAGERIAL]);
    const { id } = await params;
    await sendPasswordReset(user.id, user.roles, id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
