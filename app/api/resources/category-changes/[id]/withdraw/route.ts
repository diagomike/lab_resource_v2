import { NextResponse, type NextRequest } from "next/server";
import type { CategoryChangeDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { withdrawChange } from "@/lib/server/resources/category-governance";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    return NextResponse.json<CategoryChangeDto>(await withdrawChange(user.id, id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
