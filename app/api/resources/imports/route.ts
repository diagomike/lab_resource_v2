import { NextResponse, type NextRequest } from "next/server";
import { CreateImportInput, type ImportRecordDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { createImport, listImports } from "@/lib/server/resources/imports";

/** Import records — what bought goods arrived as. GET lists them (Property
 *  Administration, the store, procurement); POST records a new one (Property
 *  Administration). Authorization lives in lib/server/resources/imports.ts. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<ImportRecordDto[]>(await listImports(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(CreateImportInput, request);
    return NextResponse.json<ImportRecordDto>(await createImport(user.id, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
