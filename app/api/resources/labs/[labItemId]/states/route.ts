import { NextResponse, type NextRequest } from "next/server";
import type { LabStatesDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { getLabStates } from "@/lib/server/resources/lab-versions";

type Params = { params: Promise<{ labItemId: string }> };

/** One lab's Current, Draft and Ideal trees, their differences, and its requests. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const { labItemId } = await params;
    return NextResponse.json<LabStatesDto>(await getLabStates(user.id, labItemId), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
