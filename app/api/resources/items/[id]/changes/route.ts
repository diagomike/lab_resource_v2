import { NextResponse, type NextRequest } from "next/server";
import type { ItemChangeDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { assertCanSeeItem } from "@/lib/server/resources/scope";
import { forItem } from "@/lib/server/resources/changes";

type Params = { params: Promise<{ id: string }> };

/** One item's change history. Scope-checked directly (not via items.ts's getOne) so
 *  this stays a single, cheap query rather than a full forest load. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    await assertCanSeeItem(user.id, id);
    const rows = await forItem(id);
    return NextResponse.json<ItemChangeDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
