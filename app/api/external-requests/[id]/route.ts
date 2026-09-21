import { NextResponse, type NextRequest } from "next/server";
import type { ExternalRequestDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getForActor } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<ExternalRequestDto>(await getForActor(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
