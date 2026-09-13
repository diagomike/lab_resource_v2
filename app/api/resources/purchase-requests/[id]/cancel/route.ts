import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { cancelPurchaseRequest } from "@/lib/server/resources/purchasing";

type Params = { params: Promise<{ id: string }> };

/** Requester-only: withdraws their own not-yet-finished request. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    await cancelPurchaseRequest(user.id, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
