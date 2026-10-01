import { NextResponse, type NextRequest } from "next/server";
import type { NotificationsDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { listNotifications } from "@/lib/server/home/notifications";

/** The signed-in person's newest notices (?limit=, default 20) and their unread count. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20) || 20;
    return NextResponse.json<NotificationsDto>(await listNotifications(user.id, limit), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
