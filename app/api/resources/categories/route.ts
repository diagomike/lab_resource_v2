import { NextResponse, type NextRequest } from "next/server";
import { CreateCategoryInput, type ResourceCategoryDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { list } from "@/lib/server/resources/categories";
import { createCategory } from "@/lib/server/resources/category-governance";

/** Categories are shared vocabulary, not scoped data — readable by anyone signed in. */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const rows = await list();
    return NextResponse.json<ResourceCategoryDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Custodians and heads add categories for their department; the admin and Property
 *  Administration add university-wide ones (category-governance.ts). */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(CreateCategoryInput, request);
    const category = await createCategory(user.id, body);
    return NextResponse.json<ResourceCategoryDto>(category, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
