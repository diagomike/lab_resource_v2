import { NextResponse, type NextRequest } from "next/server";
import { CreateCategoryInput, type ResourceCategoryDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { list, create } from "@/lib/server/resources/categories";

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

/** Who administers categories is an open item in the replatforming plan (§10.4) —
 *  SYS_ADMIN/PROPERTY_ADMIN is the conservative default until that is settled;
 *  leaving it wide open would let any signed-in user redefine "Computer" for
 *  everyone in the register. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const body = await parseBody(CreateCategoryInput, request);
    const category = await create(user.id, body);
    return NextResponse.json<ResourceCategoryDto>(category, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
