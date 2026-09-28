import { NextResponse, type NextRequest } from "next/server";
import { CloseExternalRequestInput, ExtendHoldsInput, ForwardExternalRequestInput, PlaceHoldInput, SendQuoteInput, type ExternalRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { closeRequest, extendHolds, forward, placeHold, sendQuote } from "@/lib/server/external/requests";
import { confirmPayment } from "@/lib/server/payments/verify";

type Params = { params: Promise<{ id: string; action: string }> };

/**
 * The staff steps on one external request. Authorization lives in the service:
 *  - forward — the AVP sends it to colleges (each dean takes it on from there — see
 *    ../../assignments/[id]/[action]);
 *  - hold — a custodian a head asked holds a slot on a room (or a machine) they keep;
 *  - extend-holds — the AVP, or a dean or head on it, keeps holds alive longer;
 *  - quote — the AVP sends the single quote once every college is decided;
 *  - decline — the AVP closes it;
 *  - confirm — the AVP confirms a paid request's payment: its holds become bookings and
 *    the requester sees the contact persons (also the retry after a lost slot).
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id, action } = await params;
    let result: ExternalRequestDto;
    switch (action) {
      case "forward":
        result = await forward(user.id, id, await parseBody(ForwardExternalRequestInput, request));
        break;
      case "hold":
        result = await placeHold(user.id, id, await parseBody(PlaceHoldInput, request));
        break;
      case "extend-holds":
        result = await extendHolds(user.id, id, (await parseBody(ExtendHoldsInput, request)).until);
        break;
      case "quote":
        result = await sendQuote(user.id, id, await parseBody(SendQuoteInput, request));
        break;
      case "decline":
        result = await closeRequest(user.id, id, await parseBody(CloseExternalRequestInput, request));
        break;
      case "confirm":
        result = await confirmPayment(user.id, id);
        break;
      default:
        throw new HttpError(404, "Not found");
    }
    return NextResponse.json<ExternalRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
