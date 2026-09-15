import { NextResponse, type NextRequest } from "next/server";
import { SubmitPaymentInput, type SubmitPaymentResultDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { submitPayment } from "@/lib/server/payments/verify";

type Params = { params: Promise<{ token: string }> };

/**
 * No session — the requester confirms a payment against their quote. A receipt the bank
 * doesn't vouch for is still a 200 with `outcome: "REJECTED"` and the reason, so the page
 * can offer manual review; only a request that isn't payable, or a reused reference,
 * is an error.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { token } = await params;
    const body = await parseBody(SubmitPaymentInput, request);
    return NextResponse.json<SubmitPaymentResultDto>(await submitPayment(token, body), { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
