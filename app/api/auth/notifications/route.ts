import { NextResponse, type NextRequest } from "next/server";
import { SetEmailNotificationsInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { setOwnEmailNotifications } from "@/lib/server/auth/auth";

/** The signed-in person turns their own notification emails on or off (Profile). */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(SetEmailNotificationsInput, request);
    await setOwnEmailNotifications(user.id, body.enabled);
    return NextResponse.json({ ok: true, emailNotifications: body.enabled }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
