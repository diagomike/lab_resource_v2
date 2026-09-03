import { NextResponse, type NextRequest } from "next/server";
import type { ItemDetailDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getOne } from "@/lib/server/resources/items";

type Params = { params: Promise<{ id: string }> };

/** Out-of-scope returns 404, not 403 — see scope.ts's own note. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const item = await getOne(user.id, id);
    return NextResponse.json<ItemDetailDto>(item, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
