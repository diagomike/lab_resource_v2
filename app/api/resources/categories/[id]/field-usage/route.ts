import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { fieldUsage } from "@/lib/server/resources/categories";

type Params = { params: Promise<{ id: string }> };

/** Per detail: how many items hold a value, and the distinct values — what the editor
 *  shows ("25 in use"), asks about before a rename, and offers as a choice's options. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    await requireSession(request);
    const { id } = await params;
    return NextResponse.json(await fieldUsage(id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
