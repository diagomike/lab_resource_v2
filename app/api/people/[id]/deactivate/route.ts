import { NextResponse, type NextRequest } from "next/server";
import type { DeactivateResultDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { deactivate } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const result = await deactivate(id);
    return NextResponse.json<DeactivateResultDto>(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
