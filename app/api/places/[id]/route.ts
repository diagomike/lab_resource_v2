import { NextResponse, type NextRequest } from "next/server";
import { UpdatePlaceInput, type PlaceDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { getPlace, removePlace, updatePlace } from "@/lib/server/resources/places";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const { id } = await params;
    return NextResponse.json<PlaceDto>(await getPlace(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Its name, its details, or its custodian — by whoever manages the unit's places. */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(UpdatePlaceInput, request);
    return NextResponse.json<PlaceDto>(await updatePlace(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** An empty lab or store only. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    await removePlace(user.id, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
