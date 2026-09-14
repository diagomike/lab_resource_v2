import { NextResponse, type NextRequest } from "next/server";
import type { PublicTrackingDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { trackByToken } from "@/lib/server/external/requests";

type Params = { params: Promise<{ token: string }> };

/** No session — the requester's own request, reached by the token in their emailed link. */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { token } = await params;
    return NextResponse.json<PublicTrackingDto>(await trackByToken(token), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
