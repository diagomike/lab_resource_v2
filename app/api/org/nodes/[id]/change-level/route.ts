import { NextResponse, type NextRequest } from "next/server";
import { ChangeNodeLevelInput, type OrgNodeDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { changeLevel } from "@/lib/server/org/org";

type Params = { params: Promise<{ id: string }> };

/** Severs every edge this node holds in either direction — nothing is auto-reconnected,
 *  the admin redraws them afterward via reassignParents/addEdge. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(ChangeNodeLevelInput, request);
    const node = await changeLevel(id, body.level);
    return NextResponse.json<OrgNodeDto>(node, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
