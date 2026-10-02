import { NextResponse, type NextRequest } from "next/server";
import { CancelProcurementInput, type ProcurementDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { cancelProcurement } from "@/lib/server/resources/procurements";

type Params = { params: Promise<{ id: string }> };

/** Stop it before it arrives; its requests go back to waiting for procurement. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(CancelProcurementInput, request);
    return NextResponse.json<ProcurementDto>(await cancelProcurement(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
