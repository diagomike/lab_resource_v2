import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireRole, requireSession } from "@/lib/server/auth/session";
import { issueRecipients } from "@/lib/server/resources/staff-holdings";

/** People the store keeper can issue something to ("Hand over… → To a person"):
 *  active staff with a department, matching `q` (at least 2 characters). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["STORE_KEEPER", "SYS_ADMIN"]);
    return NextResponse.json(await issueRecipients(request.nextUrl.searchParams.get("q") ?? ""), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
