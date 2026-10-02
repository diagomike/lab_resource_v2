import { NextResponse, type NextRequest } from "next/server";
import { StartProcurementInput, type ProcurementDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listProcurements, startProcurement } from "@/lib/server/resources/procurements";

/** Every procurement (the purchasing roles), or the ones buying the caller's requests. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<ProcurementDto[]>(await listProcurements(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Procurement starts buying: from approved requests, or a standalone EGP purchase. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(StartProcurementInput, request);
    return NextResponse.json<ProcurementDto>(await startProcurement(user.id, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
