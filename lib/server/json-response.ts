import "server-only";
import { gzipSync } from "node:zlib";
import type { NextRequest } from "next/server";

/**
 * A JSON response, gzipped when it is big and the browser accepts gzip.
 *
 * The register tree for the real data is ~6.7 MB of JSON (every item, with its names
 * and path) and ~170 KB gzipped. `next dev` sends it uncompressed, and a proxy or host
 * without compression would too. Doing it here makes it small everywhere. Next's own
 * compression (`next start`) and Vercel's both leave an already-encoded response alone.
 */
export function jsonResponse(request: NextRequest, data: unknown, status = 200): Response {
  const body = JSON.stringify(data);
  const acceptsGzip = /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
  if (body.length < 32_768 || !acceptsGzip) {
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }
  return new Response(gzipSync(body, { level: 5 }), {
    status,
    headers: { "content-type": "application/json", "content-encoding": "gzip", vary: "Accept-Encoding" },
  });
}
