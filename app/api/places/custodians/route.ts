import { NextResponse, type NextRequest } from "next/server";
import type { PlaceCustodianDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { custodianCandidates } from "@/lib/server/resources/places";

/** `?unit=<id>` — who can run a place of that unit (its custodians and store keepers). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const unit = request.nextUrl.searchParams.get("unit");
    if (!unit) throw new HttpError(400, "Choose a unit.");
    return NextResponse.json<PlaceCustodianDto[]>(await custodianCandidates(user.id, unit), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
