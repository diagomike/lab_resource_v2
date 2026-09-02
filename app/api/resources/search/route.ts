import { NextResponse, type NextRequest } from "next/server";
import type { ItemRowDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { search } from "@/lib/server/resources/items";

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const categoryId = request.nextUrl.searchParams.get("categoryId") ?? undefined;
    const rows = await search(user.id, { categoryId });
    return NextResponse.json<ItemRowDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
