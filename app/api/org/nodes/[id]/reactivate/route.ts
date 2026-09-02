import { NextResponse, type NextRequest } from "next/server";
import type { OrgNodeDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { reactivateNode } from "@/lib/server/org/org";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const node = await reactivateNode(id);
    return NextResponse.json<OrgNodeDto>(node, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
