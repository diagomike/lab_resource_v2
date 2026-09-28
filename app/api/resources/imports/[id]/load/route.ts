import { NextResponse, type NextRequest } from "next/server";
import { LoadImportLineInput, type ImportRecordDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { loadImportLine } from "@/lib/server/resources/imports";

type Params = { params: Promise<{ id: string }> };

/** The store keeper loads (part of) one line of an import record into the store — the
 *  one seam between purchasing and the register. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(LoadImportLineInput, request);
    return NextResponse.json<ImportRecordDto>(await loadImportLine(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
