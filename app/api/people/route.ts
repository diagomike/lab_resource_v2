import { NextResponse, type NextRequest } from "next/server";
import { CreatePersonInput, type CreatePersonResultDto, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { list, create } from "@/lib/server/people/people";

/** The directory, for whoever manages people: heads (the MANAGER label is a pre-filter
 *  only; the list itself follows reach), the ADAA and Property Administration. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "MANAGER", "PROPERTY_ADMIN", "ADAA"]);
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
