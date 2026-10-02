import { NextResponse, type NextRequest } from "next/server";
import { DistributeInput, type DistributeResultDto, type DistributionDto } from "@/lib/shared";
import { parseBody } from "@/lib/server/validate";
import { errorResponse } from "@/lib/server/http-error";
import { requireSession } from "@/lib/server/auth/session";
import { distribute, distributionFor } from "@/lib/server/resources/distribution";

/** The store keeper's Distribute: what purchases brought for which labs, and free stock. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireSession(request);
    return NextResponse.json<DistributionDto>(await distributionFor(user.id), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Send stock to labs: one store handover per lab. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireSession(request);
    const body = await parseBody(DistributeInput, request);
    return NextResponse.json<DistributeResultDto>(await distribute(user.id, body), { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
