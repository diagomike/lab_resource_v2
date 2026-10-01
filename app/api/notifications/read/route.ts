import { NextResponse, type NextRequest } from "next/server";
import { MarkNotificationsReadInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { markRead } from "@/lib/server/home/notifications";

/** `{ ids }` marks those read; `{ all: true }` marks everything read. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(MarkNotificationsReadInput, request);
    return NextResponse.json({ marked: await markRead(user.id, body) }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
