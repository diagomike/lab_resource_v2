import { NextResponse, type NextRequest } from "next/server";
import { RegisterInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { register } from "@/lib/server/auth/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await parseBody(RegisterInput, request);
    const result = await register(body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
