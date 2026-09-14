import { NextResponse, type NextRequest } from "next/server";
import type { ExternalRequestSummaryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listForActor } from "@/lib/server/external/requests";

/** External requests this person has a part in: all of them for the AVP's office, those
 *  sent to their department for a head or custodian. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<ExternalRequestSummaryDto[]>(await listForActor(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
