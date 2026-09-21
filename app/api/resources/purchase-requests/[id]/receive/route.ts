import { NextResponse, type NextRequest } from "next/server";
import { ReceivePurchaseLineInput, type PurchaseRequestDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { receivePurchaseLine } from "@/lib/server/resources/purchasing";

type Params = { params: Promise<{ id: string }> };

/** The store keeper registers arrived stock as a real Item, through the ordinary
 *  write door — the one seam between purchasing and the register. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(ReceivePurchaseLineInput, request);
    const result = await receivePurchaseLine(user.id, id, body);
    return NextResponse.json<PurchaseRequestDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
