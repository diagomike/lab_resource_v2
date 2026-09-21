import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { letterFor } from "@/lib/server/external/requests";

type Params = { params: Promise<{ id: string }> };

/** The requester's official letter, for the staff who have a part in the request. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireSession(request);
    const { id } = await params;
    const { bytes, fileName } = await letterFor(user.id, id);
    const safeName = fileName.replace(/[^\w.\- ]+/g, "_");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
