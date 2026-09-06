import { NextResponse, type NextRequest } from "next/server";
import type { ItemFilterFieldDef } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { filterFields } from "@/lib/server/resources/items";
import { resolveReadOverride } from "@/lib/server/resources/views";

/** The filter bar's column list, including the synthetic prop:/desc: fields for
 *  whichever categories `categoryId` names as active — repeat the param for more
 *  than one. `?scope=UNIVERSITY`/`?view=<id>` — see `/items`'s own note. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;
    const readOverride = await resolveReadOverride(user.id, sp);

    const activeCategoryIds = sp.getAll("categoryId");
    const result = await filterFields(user.id, activeCategoryIds, readOverride.scope, readOverride.extraFilters);
    return NextResponse.json<ItemFilterFieldDef[]>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
