import { NextResponse, type NextRequest } from "next/server";
import { DeclineNeedInput, type NeedLineDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { declineNeed } from "@/lib/server/resources/purchasing";

type Params = { params: Promise<{ id: string }> };

/** Head-of-unit only: declines an OPEN need with a note, rather than silently
 *  leaving it unread. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(DeclineNeedInput, request);
    const result = await declineNeed(user.id, id, body);
    return NextResponse.json<NeedLineDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
