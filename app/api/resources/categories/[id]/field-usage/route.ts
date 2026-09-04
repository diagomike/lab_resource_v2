import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { fieldUsageCounts } from "@/lib/server/resources/categories";

type Params = { params: Promise<{ id: string }> };

/** field key → how many of this category's items hold a value under it — what locks a
 *  field's key input in the Studio editor. Same gate as category management itself:
 *  only useful to whoever is about to edit this category's fields. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    const counts = await fieldUsageCounts(id);
    return NextResponse.json<Record<string, number>>(counts, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
