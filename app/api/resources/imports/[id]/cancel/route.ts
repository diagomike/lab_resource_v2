import { NextResponse, type NextRequest } from "next/server";
import { CancelImportInput, type ImportRecordDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { cancelImport } from "@/lib/server/resources/imports";

type Params = { params: Promise<{ id: string }> };

/** Property Administration withdraws a record nothing has been loaded from yet. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(CancelImportInput, request);
    return NextResponse.json<ImportRecordDto>(await cancelImport(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
