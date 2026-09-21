import { NextResponse, type NextRequest } from "next/server";
import { RaiseNeedInput, type NeedLineDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listMyNeeds, listOpenNeeds, raiseNeed } from "@/lib/server/resources/purchasing";

/** "We could use one of these." Anyone attached to a unit, except a student. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(RaiseNeedInput, request);
    const result = await raiseNeed(user.id, body);
    return NextResponse.json<NeedLineDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** `?node=<id>` — every OPEN need raised at that unit, head-only (what a head reads
 *  while compiling their own request). Omitted — every need this actor raised,
 *  any status. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const node = request.nextUrl.searchParams.get("node");
    const rows = node ? await listOpenNeeds(user.id, node) : await listMyNeeds(user.id);
    return NextResponse.json<NeedLineDto[]>(rows, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
