import { NextResponse, type NextRequest } from "next/server";
import type { PeopleReachDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { reachFor } from "@/lib/server/people/people";

/** The units this person may add people to, and the roles they may give. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<PeopleReachDto>(await reachFor(user.id, user.roles), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
