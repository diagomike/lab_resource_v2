import { NextResponse, type NextRequest } from "next/server";
import type { MeContextDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { me } from "@/lib/server/auth/auth";

export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const context = await me(user);
    return NextResponse.json<MeContextDto>(context, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
