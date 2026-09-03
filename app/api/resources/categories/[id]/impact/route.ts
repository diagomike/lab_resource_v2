import { NextResponse, type NextRequest } from "next/server";
import { UpdateCategoryInput, type CategoryImpactDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession, requireRole } from "@/lib/server/auth/session";
import { previewImpact } from "@/lib/server/resources/categories";

type Params = { params: Promise<{ id: string }> };

const ImpactDraft = UpdateCategoryInput.omit({ expectedVersion: true, purgeKeys: true, note: true });

/** The blast-radius preview for a pending category edit, computed but never
 *  persisted — same role gate as the edit itself, since previewing is only useful to
 *  whoever is about to make the edit. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    requireRole(user, ["SYS_ADMIN", "PROPERTY_ADMIN"]);
    const { id } = await params;
    const draft = await parseBody(ImpactDraft, request);
    const impact = await previewImpact(id, draft);
    return NextResponse.json<CategoryImpactDto>(impact, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
