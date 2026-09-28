import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireRole, requireSession, STAFF_ROLES } from "@/lib/server/auth/session";
import { listCentralStores } from "@/lib/server/resources/approvals";

/** The Main Store(s) a resource can be returned into — "Return to store" in the
 *  Register. Whether the return is allowed, and who approves it, is decided when it is
 *  requested (lib/server/resources/approvals.ts), not here. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    return NextResponse.json(await listCentralStores(), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
