import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { withdrawDraft } from "@/lib/server/resources/lab-drafts";

type Params = { params: Promise<{ id: string }> };

/** Withdraw one still-OPEN staged change before it is ever submitted. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    await withdrawDraft(user.id, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
