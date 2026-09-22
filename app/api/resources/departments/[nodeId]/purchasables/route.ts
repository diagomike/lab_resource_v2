import { NextResponse, type NextRequest } from "next/server";
import type { DepartmentPurchasablesDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getDepartmentPurchasables } from "@/lib/server/resources/lab-versions";

type Params = { params: Promise<{ nodeId: string }> };

/** Every lab this department owns, rolled up against its approved ideal state — what
 *  the head reads while compiling a purchase request. Head-of-unit or SYS_ADMIN. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { nodeId } = await params;
    const dto = await getDepartmentPurchasables(user.id, nodeId);
    return NextResponse.json<DepartmentPurchasablesDto>(dto, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
