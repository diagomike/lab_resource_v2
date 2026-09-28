import { NextResponse, type NextRequest } from "next/server";
import type { PublicTrackingDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireRole, requireSession } from "@/lib/server/auth/session";
import { cancelForRequester } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

/** The requester withdraws their own request, before any money has been accepted. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["EXTERNAL"]);
    const { id } = await params;
    return NextResponse.json<PublicTrackingDto>(await cancelForRequester(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
