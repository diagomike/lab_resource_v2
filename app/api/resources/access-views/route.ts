import { NextResponse, type NextRequest } from "next/server";
import { UpsertAccessViewInput, type AccessViewDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { list, upsert } from "@/lib/server/resources/views";

/** Access views are shared administrative vocabulary — the full authored list is
 *  admin-only, same pairing categories.ts's own routes use (open item 4 of
 *  ~/.claude/plans/wait-i-want-gentle-haven.md, settled the same way here). What a
 *  signed-in person may actually choose between is a narrower, per-person list —
 *  MeContextDto's own `views` field, not this endpoint. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const rows = await list();
    return NextResponse.json<AccessViewDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const body = await parseBody(UpsertAccessViewInput, request);
    const view = await upsert(body);
    return NextResponse.json<AccessViewDto>(view, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
