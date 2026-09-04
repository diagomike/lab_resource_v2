import { NextResponse, type NextRequest } from "next/server";
import { itemChangeKinds, itemChangeTargets, type ChangeLogPageDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { browse, type ChangeLogQuery } from "@/lib/server/resources/changes";

/** The global change log — scope, search, filtering, ordering and pagination all run
 *  server-side (changes.ts's `browse`); this handler only parses query params and
 *  never sees more rows than the caller's own scope already limited the query to. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const sp = request.nextUrl.searchParams;

    const kindParam = sp.get("kind");
    const targetKindParam = sp.get("targetKind");
    const query: ChangeLogQuery = {
      q: sp.get("q") ?? undefined,
      kind: kindParam && (itemChangeKinds as readonly string[]).includes(kindParam) ? (kindParam as ChangeLogQuery["kind"]) : undefined,
      targetKind: targetKindParam && (itemChangeTargets as readonly string[]).includes(targetKindParam) ? (targetKindParam as ChangeLogQuery["targetKind"]) : undefined,
      actorId: sp.get("actorId") ?? undefined,
      categoryId: sp.get("categoryId") ?? undefined,
      itemId: sp.get("itemId") ?? undefined,
      batchId: sp.get("batchId") ?? undefined,
    };
    const page = Number(sp.get("page") ?? "1") || 1;
    const pageSize = Number(sp.get("pageSize") ?? "50") || 50;

    const result = await browse(user.id, query, page, pageSize);
    return NextResponse.json<ChangeLogPageDto>(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
