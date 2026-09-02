import { NextResponse, type NextRequest } from "next/server";
import type { DeactivateNodeResultDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { deactivateNode } from "@/lib/server/org/org";

type Params = { params: Promise<{ id: string }> };

/** Revokes the current occupant (if any) and marks the node inactive in one step. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const result = await deactivateNode(id);
    return NextResponse.json<DeactivateNodeResultDto>(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
