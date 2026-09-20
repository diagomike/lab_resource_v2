import { NextResponse, type NextRequest } from "next/server";
import { CreateOrgEdgeInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { createEdge } from "@/lib/server/org/org";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const body = await parseBody(CreateOrgEdgeInput, request);
    await createEdge(body.parentId, body.childId);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
