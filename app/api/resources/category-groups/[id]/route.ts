import { NextResponse, type NextRequest } from "next/server";
import { RenameCategoryGroupInput, type CategoryGroupDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { rename, remove } from "@/lib/server/resources/category-groups";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(RenameCategoryGroupInput, request);
    const group = await rename(id, body);
    return NextResponse.json<CategoryGroupDto>(group, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Blocked while any category is still filed under it — see category-groups.ts's own
 *  remove(). */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    await remove(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
