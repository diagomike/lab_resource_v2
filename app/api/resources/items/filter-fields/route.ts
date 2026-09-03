import { NextResponse, type NextRequest } from "next/server";
import type { ItemFilterFieldDef } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { filterFields } from "@/lib/server/resources/items";

/** The filter bar's column list, including the synthetic prop:/desc: fields for
 *  whichever categories `categoryId` names as active — repeat the param for more
 *  than one. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const activeCategoryIds = request.nextUrl.searchParams.getAll("categoryId");
    const result = await filterFields(user.id, activeCategoryIds);
    return NextResponse.json<ItemFilterFieldDef[]>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
