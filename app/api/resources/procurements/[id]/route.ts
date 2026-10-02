import { NextResponse, type NextRequest } from "next/server";
import type { ProcurementDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getProcurement } from "@/lib/server/resources/procurements";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<ProcurementDto>(await getProcurement(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
