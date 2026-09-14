import { NextResponse, type NextRequest } from "next/server";
import type { SchedulingLabDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getLab } from "@/lib/server/scheduling/reservations";

type Params = { params: Promise<{ id: string }> };

/** One bookable room and the machines inside it that can be booked. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<SchedulingLabDto>(await getLab(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
