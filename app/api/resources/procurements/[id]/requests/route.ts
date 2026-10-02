import { NextResponse, type NextRequest } from "next/server";
import { AddProcurementRequestsInput, type ProcurementDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { addRequests } from "@/lib/server/resources/procurements";

type Params = { params: Promise<{ id: string }> };

/** Add approved requests while it is still being prepared. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(AddProcurementRequestsInput, request);
    return NextResponse.json<ProcurementDto>(await addRequests(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
