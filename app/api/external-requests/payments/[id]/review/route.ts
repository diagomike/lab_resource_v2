import { NextResponse, type NextRequest } from "next/server";
import { ReviewPaymentInput, type ExternalRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { reviewPayment } from "@/lib/server/payments/verify";

type Params = { params: Promise<{ id: string }> };

/** The AVP's office checks by hand a payment the verifier couldn't. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(ReviewPaymentInput, request);
    return NextResponse.json<ExternalRequestDto>(await reviewPayment(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
