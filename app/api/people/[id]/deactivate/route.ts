import { NextResponse, type NextRequest } from "next/server";
import type { DeactivateResultDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { deactivate } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

/** No role gate at the route: deactivate is admin-or-head, scoped inside deactivate() itself
 *  (F-014 of the 2026-09-15 campaign) — see people.ts's own assertMayManageStaff. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const result = await deactivate(user.id, user.roles, id);
    return NextResponse.json<DeactivateResultDto>(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
