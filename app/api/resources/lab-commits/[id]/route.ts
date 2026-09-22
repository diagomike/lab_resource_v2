import { NextResponse, type NextRequest } from "next/server";
import type { LabCommitRequestDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getRequest } from "@/lib/server/resources/lab-versions";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const row = await getRequest(user.id, id);
    return NextResponse.json<LabCommitRequestDto>(row, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
