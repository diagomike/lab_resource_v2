import { NextResponse, type NextRequest } from "next/server";
import type { ItemDetailDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getOne } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/views";

type Params = { params: Promise<{ id: string }> };

/** Out-of-scope returns 404, not 403 — see scope.ts's own note. `?scope=UNIVERSITY`/
 *  `?view=<id>` — see `/items`'s own note; this is the university browse's AND the
 *  access-view drill-through. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const sp = request.nextUrl.searchParams;
    const readOverride = await resolveReadOverride(user.id, sp);

    const item = await getOne(user.id, id, readOverride.scope);
    return NextResponse.json<ItemDetailDto>(item, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
