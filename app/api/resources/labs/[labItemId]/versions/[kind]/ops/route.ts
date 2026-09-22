import { NextResponse, type NextRequest } from "next/server";
import { VersionOpInput } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { applyVersionEdit } from "@/lib/server/resources/lab-versions";

type Params = { params: Promise<{ labItemId: string; kind: string }> };

export function versionKind(raw: string): "DRAFT" | "IDEAL_PROPOSAL" {
  if (raw === "draft") return "DRAFT";
  if (raw === "ideal") return "IDEAL_PROPOSAL";
  throw new HttpError(404, "Not found");
}

/** One edit to the lab's Draft (`draft`) or Ideal proposal (`ideal`). `?dryRun=1`
 *  validates and reports the names it would give, without saving. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { labItemId, kind } = await params;
    const body = await parseBody(VersionOpInput, request);
    const result = await applyVersionEdit(user.id, labItemId, versionKind(kind), body, { dryRun: request.nextUrl.searchParams.get("dryRun") === "1" });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
