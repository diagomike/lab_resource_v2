import { NextResponse, type NextRequest } from "next/server";
import { SetEmailNotificationsInput, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { setEmailNotifications } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

/** No role gate at the route: admin-or-head, scoped inside setEmailNotifications()
 *  (people.ts's assertMayManageStaff), like every other People action. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(SetEmailNotificationsInput, request);
    const person = await setEmailNotifications(user.id, user.roles, id, body.enabled);
    return NextResponse.json<PersonDto>(person, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
