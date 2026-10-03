import { NextResponse, type NextRequest } from "next/server";
import { SetPhoneInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { setOwnPhone } from "@/lib/server/auth/auth";

/** The signed-in person sets or clears their own phone number (Profile). */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(SetPhoneInput, request);
    await setOwnPhone(user.id, body.phone);
    return NextResponse.json({ ok: true, phone: body.phone || null }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
