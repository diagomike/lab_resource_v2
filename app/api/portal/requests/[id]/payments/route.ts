import { NextResponse, type NextRequest } from "next/server";
import { SubmitPaymentInput, type SubmitPaymentResultDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireRole, requireSession } from "@/lib/server/auth/session";
import { assertOwnRequest } from "@/lib/server/external/requests";
import { submitPayment } from "@/lib/server/payments/verify";

type Params = { params: Promise<{ id: string }> };

/**
 * The requester confirms a payment against their quote. A receipt the bank doesn't vouch
 * for is still a 200 with `outcome: "REJECTED"` and the reason, so the page can offer
 * manual review; only a request that isn't payable, or a reused reference, is an error.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["EXTERNAL"]);
    const { id } = await params;
    await assertOwnRequest(user.id, id);
    const body = await parseBody(SubmitPaymentInput, request);
    return NextResponse.json<SubmitPaymentResultDto>(await submitPayment(id, body), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
