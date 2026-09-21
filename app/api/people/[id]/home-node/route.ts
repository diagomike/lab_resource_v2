import { NextResponse, type NextRequest } from "next/server";
import { MoveHomeNodeInput, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { moveHomeNode } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

/** F-015 of the 2026-09-15 campaign — moves a person's home DEPARTMENT (membership),
 *  distinct from assign-node's occupancy/headship. SYS_ADMIN-only; see
 *  people.ts's moveHomeNode for the blockers and history it records. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(MoveHomeNodeInput, request);
    const person = await moveHomeNode(user.id, id, body);
    return NextResponse.json<PersonDto>(person, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
