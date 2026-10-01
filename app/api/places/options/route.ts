import { NextResponse, type NextRequest } from "next/server";
import type { PlaceOptionsDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { placeOptions } from "@/lib/server/resources/places";

/** The kinds of place and the units the caller manages — the "Add a lab or store" form. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<PlaceOptionsDto>(await placeOptions(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
