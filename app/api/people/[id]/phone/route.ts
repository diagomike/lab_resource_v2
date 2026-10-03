import { NextResponse, type NextRequest } from "next/server";
import { SetPhoneInput, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { setPhone } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

/** No role gate at the route: scoped inside setPhone() (people.ts's assertMayManageStaff),
 *  like every other People action. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(SetPhoneInput, request);
    const person = await setPhone(user.id, user.roles, id, body.phone);
    return NextResponse.json<PersonDto>(person, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
