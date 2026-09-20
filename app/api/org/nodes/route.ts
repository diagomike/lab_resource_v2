import { NextResponse, type NextRequest } from "next/server";
import { CreateOrgNodeInput, type OrgNodeDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { list, create } from "@/lib/server/org/org";

/** Readable by anyone signed in — the org chart names the units, not their contents.
 *  Occupant emails only go to admins and managers (F-011). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const scopeParam = request.nextUrl.searchParams.get("scope");
    const rows = await list(scopeParam !== "all", { includeEmail: user.roles.some((r) => r === "SYS_ADMIN" || r === "MANAGER") });
    return NextResponse.json<OrgNodeDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const body = await parseBody(CreateOrgNodeInput, request);
    const node = await create(body);
    return NextResponse.json<OrgNodeDto>(node, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
