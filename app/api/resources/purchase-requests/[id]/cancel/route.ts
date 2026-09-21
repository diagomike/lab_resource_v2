import { NextResponse, type NextRequest } from "next/server";
import { CancelPurchaseRequestInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { cancelPurchaseRequest } from "@/lib/server/resources/purchasing";

type Params = { params: Promise<{ id: string }> };

/** The raiser withdraws their own request while it's still theirs to decide
 *  (APPROVING/REVISING); once it's ORDER_PLACED or beyond, only procurement may
 *  cancel it, with a required note (F-047 of the 2026-09-15 campaign) — see
 *  purchasing.ts's own cancelPurchaseRequest for the scoping. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(CancelPurchaseRequestInput, request);
    await cancelPurchaseRequest(user.id, id, body.note);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
