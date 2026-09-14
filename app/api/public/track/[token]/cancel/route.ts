import { NextResponse, type NextRequest } from "next/server";
import type { PublicTrackingDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { cancelByToken } from "@/lib/server/external/requests";

type Params = { params: Promise<{ token: string }> };

/** No session — the requester withdraws their request before paying. */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { token } = await params;
    return NextResponse.json<PublicTrackingDto>(await cancelByToken(token), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
