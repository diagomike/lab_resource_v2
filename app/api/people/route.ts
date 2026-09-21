import { NextResponse, type NextRequest } from "next/server";
import { CreatePersonInput, type CreatePersonResultDto, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { list, create } from "@/lib/server/people/people";

/** GET's own, slightly wider gate than POST's: PROPERTY_ADMIN never invites people,
 *  but does need the read-only directory to assign a PERSON-specific access view
 *  (Track 1's AccessViewsPage) — a name/role list, not an invite capability. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "MANAGER", "PROPERTY_ADMIN"]);
    const rows = await list(user.id, user.roles);
    return NextResponse.json<PersonDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * No role gate here (F-017 of the 2026-09-15 campaign): who may invite is an
 * OCCUPANCY question (a department head), not a role one, and `create()` itself is
 * the single place that now resolves it — a route-level `requireRole(["MANAGER"])`
 * pre-filter would refuse a genuine head who occupies a node but happens not to
 * (or no longer) carry the MANAGER role label, before ever reaching that check.
 * `create()` still refuses everyone else (including SYS_ADMIN-less non-occupants)
 * with the identical 403.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(CreatePersonInput, request);
    const person = await create(user.id, user.roles, body);
    return NextResponse.json<CreatePersonResultDto>(person, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
