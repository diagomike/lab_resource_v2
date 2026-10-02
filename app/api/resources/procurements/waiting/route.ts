import { NextResponse, type NextRequest } from "next/server";
import type { WaitingRequestDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { waitingRequests } from "@/lib/server/resources/procurements";

/** Approved requests procurement hasn't started buying yet. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<WaitingRequestDto[]>(await waitingRequests(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
