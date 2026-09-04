import { NextResponse, type NextRequest } from "next/server";
import type { UploadSessionDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { createUploadSession } from "@/lib/server/resources/images";

type Params = { params: Promise<{ id: string }> };

/** Step 1 of the two-step upload — authorizes the caller against THIS item (the same
 *  custody-based write gate every other mutation uses) and mints a server-generated,
 *  opaque, expiring reference. The client uploads bytes to `uploadUrl` next, then
 *  finalizes with `addImage` naming `uploadSessionId` — never a storage path or key
 *  it chose itself. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const session = await createUploadSession(user.id, id);
    return NextResponse.json<UploadSessionDto>(session, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
