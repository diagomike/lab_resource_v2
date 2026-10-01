import { NextResponse, type NextRequest } from "next/server";
import { UpdateCategoryInput, type ResourceCategoryDto, type SaveCategoryResultDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { getOne } from "@/lib/server/resources/categories";
import { removeCategory, saveCategory } from "@/lib/server/resources/category-governance";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    await requireSession(request);
    const { id } = await params;
    const category = await getOne(id);
    return NextResponse.json<ResourceCategoryDto>(category, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Applies at once, or waits for approval when it changes data (category-governance.ts). */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(UpdateCategoryInput, request);
    return NextResponse.json<SaveCategoryResultDto>(await saveCategory(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Blocked while any item is still filed under it, or (unless explicitly confirmed via
 *  ?confirmTemplateRemoval=true) while another category still lists this one as a
 *  default part — see categories.ts's remove(). */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const confirmTemplateRemoval = new URL(request.url).searchParams.get("confirmTemplateRemoval") === "true";
    await removeCategory(user.id, id, { confirmTemplateRemoval });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
