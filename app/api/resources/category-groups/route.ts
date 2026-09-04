import { NextResponse, type NextRequest } from "next/server";
import { CreateCategoryGroupInput, type CategoryGroupDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { list, create } from "@/lib/server/resources/category-groups";

/** The group vocabulary is shared read, same as categories themselves. */
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    const rows = await list();
    return NextResponse.json<CategoryGroupDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Same gate as category management itself — see categories/route.ts's own note. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const body = await parseBody(CreateCategoryGroupInput, request);
    const group = await create(body);
    return NextResponse.json<CategoryGroupDto>(group, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
