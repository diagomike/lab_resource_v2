import { NextResponse, type NextRequest } from "next/server";
import type { BookablePlaceDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { bookablePlaces } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

/** The department's places its head may book for the request, with what each holds of
 *  the kinds the request's lab setups need. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<BookablePlaceDto[]>(await bookablePlaces(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
