import { NextResponse, type NextRequest } from "next/server";
import type { ResourceCategoryDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { copyCategory } from "@/lib/server/resources/category-governance";

type Params = { params: Promise<{ id: string }> };

/** "Make a copy for my department" — same details and parts, looked after by the
 *  person's own department. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<ResourceCategoryDto>(await copyCategory(user.id, id), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
