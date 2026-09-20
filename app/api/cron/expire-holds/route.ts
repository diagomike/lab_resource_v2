import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, HttpError } from "@/lib/server/http-error";
import { prisma } from "@/lib/server/prisma";
import { expireHolds, expireLapsedRequests } from "@/lib/server/scheduling/context";
import { expireOverdueQuotes } from "@/lib/server/external/requests";

/**
 * Scheduled sweep (vercel.json crons): lapsed holds stop blocking, quotes past their
 * payment deadline expire, and a REQUESTED booking nobody decided before its own start
 * time lapses too (F-050 of the 2026-09-15 campaign) rather than sitting in an inbox
 * for a slot that has already passed. Every scheduling write already sweeps its own
 * lab for holds, so this mostly keeps calendars tidy and tells requesters their quote
 * lapsed — correctness never waits on it. Vercel sends
 * `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Not authorized");
    const quotes = await expireOverdueQuotes();
    const holds = await expireHolds(prisma);
    const lapsedRequests = await expireLapsedRequests(prisma);
    return NextResponse.json({ expiredQuotes: quotes, expiredHolds: holds, expiredRequests: lapsedRequests }, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
