import { NextResponse } from "next/server";
import type { PublicCatalogDto } from "@/lib/shared";
import { errorResponse } from "@/lib/server/http-error";
import { publicCatalog } from "@/lib/server/resources/items";

/** No session — the public portal's counts of what the university can offer, for
 *  categories an administrator has marked public. Cached briefly at the edge. */
export async function GET() {
  try {
    return NextResponse.json<PublicCatalogDto>(await publicCatalog(), {
      status: 200,
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
