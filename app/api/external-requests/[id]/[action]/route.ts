import { NextResponse, type NextRequest } from "next/server";
import { CloseExternalRequestInput, ExtendHoldsInput, ForwardExternalRequestInput, PlaceHoldInput, SendQuoteInput, type ExternalRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { closeRequest, extendHolds, forward, placeHold, sendQuote } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string; action: string }> };

/**
 * The staff steps on one external request. Authorization lives in the service:
 *  - forward — the AVP sends it to departments;
 *  - hold — a custodian holds a slot on a room of an assigned department;
 *  - extend-holds — the AVP or an assigned head keeps holds alive longer;
 *  - quote — the AVP sends the single quote once every department has answered;
 *  - decline — the AVP closes it.
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
      default:
        throw new HttpError(404, "Not found");
    }
    return NextResponse.json<ExternalRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
