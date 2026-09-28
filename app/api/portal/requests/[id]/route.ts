import { NextResponse, type NextRequest } from "next/server";
import type { PublicTrackingDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireRole, requireSession } from "@/lib/server/auth/session";
import { viewForRequester } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

/** One of the signed-in requester's own requests — 404 for anyone else's. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["EXTERNAL"]);
    const { id } = await params;
    return NextResponse.json<PublicTrackingDto>(await viewForRequester(user.id, id), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
