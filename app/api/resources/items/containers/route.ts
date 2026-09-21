import { NextResponse, type NextRequest } from "next/server";
import type { ContainerOptionDto } from "@/lib/shared";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession, requireRole, STAFF_ROLES } from "@/lib/server/auth/session";
import { containers } from "@/lib/server/resources/items";

/** The one container-picker endpoint behind AddModal's "Into", the register
 *  toolbar's "Move to…", and Inspector's parent picker — see items.ts's `containers()`
 *  for the three-way filter (in scope, write-eligible, placement-legal). `exclude` is
 *  an optional comma-separated list of item ids whose own subtree must not appear
 *  (the item(s) being moved, so nothing can become its own descendant). STAFF_ROLES —
 *  F-031 of the 2026-09-15 campaign, same reasoning as `/items`'s own note; a
 *  student/external's write reach is always empty here anyway, but the gate matches
 *  every other register route rather than relying on that alone. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, STAFF_ROLES);
    const sp = request.nextUrl.searchParams;
    const categoryId = sp.get("categoryId");
    if (!categoryId) throw new HttpError(400, "categoryId is required.");
    const exclude = (sp.get("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    const result = await containers(user.id, categoryId, exclude);
    return NextResponse.json<ContainerOptionDto[]>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
