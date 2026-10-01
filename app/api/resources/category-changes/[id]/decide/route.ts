import { NextResponse, type NextRequest } from "next/server";
import { DecideCategoryChangeInput, type CategoryChangeDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { decideChange } from "@/lib/server/resources/category-governance";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const body = await parseBody(DecideCategoryChangeInput, request);
    return NextResponse.json<CategoryChangeDto>(await decideChange(user.id, id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
