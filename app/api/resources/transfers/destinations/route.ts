import { NextResponse, type NextRequest } from "next/server";
import type { TransferDestinationDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { transferDestinations } from "@/lib/server/resources/items";

/** Candidate transfer destinations, university-wide — see items.ts's
 *  `transferDestinations` for why this is deliberately NOT `containers()` (no custody
 *  or visibility filter; the whole point is a destination outside the requester's own
 *  reach). `itemIds` is a comma-separated list of the resources being transferred;
 *  `q` must be at least 2 characters. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const itemIds = (sp.get("itemIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const q = sp.get("q") ?? "";
    if (!itemIds.length) throw new HttpError(400, "itemIds is required.");

    const result = await transferDestinations(user.id, itemIds, q);
    return NextResponse.json<TransferDestinationDto[]>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
