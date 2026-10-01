import { NextResponse, type NextRequest } from "next/server";
import { CreatePlaceInput, type PlaceDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { createPlace, listPlaces } from "@/lib/server/resources/places";

/** The labs and stores the caller manages, and the ones they run. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    return NextResponse.json<PlaceDto[]>(await listPlaces(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A new lab or store — by whoever manages the owning unit's places (places.ts). */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(CreatePlaceInput, request);
    return NextResponse.json<PlaceDto>(await createPlace(user.id, body), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
