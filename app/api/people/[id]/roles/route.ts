import { NextResponse, type NextRequest } from "next/server";
import { UpdatePersonRolesInput, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { updateRoles } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

/** No role gate at the route: updateRoles is admin-or-head, scoped inside
 *  updateRoles() itself (F-014 of the 2026-09-15 campaign) — see people.ts's own
 *  assertMayManageStaff. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(UpdatePersonRolesInput, request);
    const person = await updateRoles(user.id, user.roles, id, body);
    return NextResponse.json<PersonDto>(person, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
