import { NextResponse, type NextRequest } from "next/server";
import { UpdatePersonRolesInput, type PersonDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { updateRoles } from "@/lib/server/people/people";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(UpdatePersonRolesInput, request);
    const person = await updateRoles(id, body);
    return NextResponse.json<PersonDto>(person, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
