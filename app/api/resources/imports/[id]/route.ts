import { NextResponse, type NextRequest } from "next/server";
import type { ImportRecordDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getImport } from "@/lib/server/resources/imports";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<ImportRecordDto>(await getImport(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
