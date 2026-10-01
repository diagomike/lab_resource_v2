import { NextResponse, type NextRequest } from "next/server";
import type { CategoryChangesDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listChanges } from "@/lib/server/resources/category-governance";

/** Category changes waiting for this person, and their own (?category= narrows to one). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const category = new URL(request.url).searchParams.get("category") ?? undefined;
    return NextResponse.json<CategoryChangesDto>(await listChanges(user.id, category), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
