import { NextResponse, type NextRequest } from "next/server";
import { MoveProcurementInput, type ProcurementDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { moveProcurement } from "@/lib/server/resources/procurements";

type Params = { params: Promise<{ id: string }> };

/** Move it forward: the next stage or any later one; arriving records what came. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(MoveProcurementInput, request);
    return NextResponse.json<ProcurementDto>(await moveProcurement(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
