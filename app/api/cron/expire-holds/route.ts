import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { prisma } from "@/lib/server/prisma";
import { expireHolds } from "@/lib/server/scheduling/context";
import { expireOverdueQuotes } from "@/lib/server/external/requests";

/**
 * Scheduled sweep (vercel.json crons): lapsed holds stop blocking, and quotes past their
 * payment deadline expire. Every scheduling write already sweeps its own lab, so this
 * only keeps calendars tidy and tells requesters their quote lapsed — correctness never
 * waits on it. Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Not authorized");
    const quotes = await expireOverdueQuotes();
    const holds = await expireHolds(prisma);
    return NextResponse.json({ expiredQuotes: quotes, expiredHolds: holds }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
