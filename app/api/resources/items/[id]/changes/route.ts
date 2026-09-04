import { NextResponse, type NextRequest } from "next/server";
import type { ItemChangeDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { assertCanBrowseUniversity, assertCanSeeItem } from "@/lib/server/resources/scope";
import { forItem } from "@/lib/server/resources/changes";

type Params = { params: Promise<{ id: string }> };

/** One item's change history. Scope-checked directly (not via items.ts's getOne) so
 *  this stays a single, cheap query rather than a full forest load. `?scope=UNIVERSITY`
 *  — the university browse's Inspector drill-through fetches this alongside the item
 *  detail itself, so it needs the same override or history would 404 the moment a
 *  MANAGER opened another department's item; see `/items`'s own note. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const university = request.nextUrl.searchParams.get("scope") === "UNIVERSITY";
    if (university) await assertCanBrowseUniversity(user.id);

    await assertCanSeeItem(user.id, id, university ? "UNIVERSITY" : undefined);
    const rows = await forItem(id);
    return NextResponse.json<ItemChangeDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
