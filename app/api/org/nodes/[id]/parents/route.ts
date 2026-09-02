import { NextResponse, type NextRequest } from "next/server";
import { ReassignParentsInput, type OrgNodeDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { reassignParents } from "@/lib/server/org/org";

type Params = { params: Promise<{ id: string }> };

/** Replaces which parent(s) this node reports under — level-adjacency enforced
 *  server-side, same as node creation. */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(ReassignParentsInput, request);
    const node = await reassignParents(id, body.parentIds);
    return NextResponse.json<OrgNodeDto>(node, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
