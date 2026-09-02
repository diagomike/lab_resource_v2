import { NextResponse, type NextRequest } from "next/server";
import { UpdateOrgNodeInput, type OrgNodeDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { update, deleteNode } from "@/lib/server/org/org";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(UpdateOrgNodeInput, request);
    const node = await update(id, body);
    return NextResponse.json<OrgNodeDto>(node, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Real deletion, only when nothing depends on the node — see org.ts's deleteNode for
 *  the full blocker list. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    await deleteNode(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
