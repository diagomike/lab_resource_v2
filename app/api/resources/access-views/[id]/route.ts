import { NextResponse, type NextRequest } from "next/server";
import { UpsertAccessViewInput, type AccessViewDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { getOne, upsert, remove } from "@/lib/server/resources/views";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    const view = await getOne(id);
    return NextResponse.json<AccessViewDto>(view, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(UpsertAccessViewInput, request);
    const view = await upsert({ ...body, id });
    return NextResponse.json<AccessViewDto>(view, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

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
