import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { setDraftWorkflowEnabled } from "@/lib/server/resources/lab-versions";

type Params = { params: Promise<{ id: string }> };

const Input = z.object({ enabled: z.boolean() });

/** Track 2's per-department rollout switch (§5.2 of
 *  ~/.claude/plans/lets-merge-the-work-memoized-journal.md) — default false for
 *  every department; SYS_ADMIN opts one in deliberately. Direct editing is
 *  completely unaffected for any department left off. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN"]);
    const { id } = await params;
    const body = await parseBody(Input, request);
    await setDraftWorkflowEnabled(id, body.enabled);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
