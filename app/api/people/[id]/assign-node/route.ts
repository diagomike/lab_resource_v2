import { NextResponse, type NextRequest } from "next/server";
import { AssignNodeInput, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { assignNode } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(AssignNodeInput, request);
    const person = await assignNode(user.id, id, body.nodeId, body.reason);
    return NextResponse.json<PersonDto>(person, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
