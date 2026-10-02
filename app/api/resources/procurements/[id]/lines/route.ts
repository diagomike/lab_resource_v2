import { NextResponse, type NextRequest } from "next/server";
import { EditProcurementLinesInput, type ProcurementDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { editLines } from "@/lib/server/resources/procurements";

type Params = { params: Promise<{ id: string }> };

/** Edit what is really being bought, saying why. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(EditProcurementLinesInput, request);
    return NextResponse.json<ProcurementDto>(await editLines(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
