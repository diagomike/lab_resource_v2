import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { cancelRequest } from "@/lib/server/resources/approvals";

type Params = { params: Promise<{ id: string }> };

/** Requester-only: withdraws their own still-PENDING transfer request. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    await cancelRequest(user.id, id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
