import { NextResponse, type NextRequest } from "next/server";
import type { CategoryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { list } from "@/lib/server/resources/categories";

/** Readable by anyone signed in — the category schema names the vocabulary, not who
 *  owns which items. Categories carry no scope of their own. */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "true";
    const rows = await list(includeInactive);
    return NextResponse.json<CategoryDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
