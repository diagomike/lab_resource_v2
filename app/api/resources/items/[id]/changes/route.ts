import { NextResponse, type NextRequest } from "next/server";
import type { ItemChangeDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { assertCanSeeItem } from "@/lib/server/resources/scope";
import { resolveReadOverride } from "@/lib/server/resources/views";
import { forItem } from "@/lib/server/resources/changes";

type Params = { params: Promise<{ id: string }> };

/** One item's change history. Scope-checked directly (not via items.ts's getOne) so
 *  this stays a single, cheap query rather than a full forest load. `?scope=UNIVERSITY`/
 *  `?view=<id>` — the Inspector drill-through fetches this alongside the item detail
 *  itself, so it needs the same override or history would 404 the moment a MANAGER or
 *  an access-view holder opened an item outside their own default scope; see
 *  `/items`'s own note. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const sp = request.nextUrl.searchParams;
    const readOverride = await resolveReadOverride(user.id, sp);

    await assertCanSeeItem(user.id, id, readOverride.scope?.mode, readOverride.scope?.explicitNodeIds);
    const rows = await forItem(id);
    return NextResponse.json<ItemChangeDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
