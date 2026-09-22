import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { discardVersion, refreshDraft, startVersion, submitVersion, withdrawVersion } from "@/lib/server/resources/lab-versions";
import { versionKind } from "../ops/route";

type Params = { params: Promise<{ labItemId: string; kind: string; action: string }> };

/** start | submit | withdraw | discard | refresh (Draft only: re-copy from Current). */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { labItemId, kind: rawKind, action } = await params;
    const kind = versionKind(rawKind);
    if (action === "submit") return NextResponse.json(await submitVersion(user.id, labItemId, kind), { status: 201 });
    if (action === "start") await startVersion(user.id, labItemId, kind);
    else if (action === "withdraw") await withdrawVersion(user.id, labItemId, kind);
    else if (action === "discard") await discardVersion(user.id, labItemId, kind);
    else if (action === "refresh" && kind === "DRAFT") await refreshDraft(user.id, labItemId);
    else throw new HttpError(404, "Not found");
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
