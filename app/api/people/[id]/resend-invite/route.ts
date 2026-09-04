import { NextResponse, type NextRequest } from "next/server";
import type { ResendInviteResultDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { resendInvite } from "@/lib/server/people/people";

const MANAGERIAL = ["SYS_ADMIN", "MANAGER"] as const;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, [...MANAGERIAL]);
    const { id } = await params;
    const result = await resendInvite(user.id, user.roles, id);
    return NextResponse.json<ResendInviteResultDto>(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
