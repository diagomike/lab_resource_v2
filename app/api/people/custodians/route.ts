import { NextResponse, type NextRequest } from "next/server";
import type { PersonSummaryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { custodians } from "@/lib/server/people/people";

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["CUSTODIAN", "PROPERTY_ADMIN"]);
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const rows = await custodians(q);
    return NextResponse.json<PersonSummaryDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
