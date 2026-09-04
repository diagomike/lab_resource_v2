import { NextResponse, type NextRequest } from "next/server";
import { UpdateCategoryInput, type ResourceCategoryDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { getOne, update, remove } from "@/lib/server/resources/categories";

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

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(UpdateCategoryInput, request);
    const category = await update(user.id, id, body);
    return NextResponse.json<ResourceCategoryDto>(category, { status: 200 });
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
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    const confirmTemplateRemoval = new URL(request.url).searchParams.get("confirmTemplateRemoval") === "true";
    await remove(user.id, id, { confirmTemplateRemoval });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
