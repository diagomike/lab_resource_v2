import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* No custom webpack/turbopack config — Turbopack is the Next.js 16 default for both
   * `next dev` and `next build`. See the conversion plan's §2.1. */

  // The in-app guide's files carry a content hash in ?v= (scripts/build-help.mjs), so a
  // browser or the CDN can keep them for good: a rebuilt guide changes the URL.
  // Old addresses keep working (bookmarks, emailed links): each lands on the screen
  // that replaced it.
  async redirects() {
    return [
      { source: "/university", destination: "/register?scope=university", permanent: false },
      // Lab states became each lab's own page under Labs & stores.
      { source: "/lab-states", has: [{ type: "query", key: "lab", value: "(?<lab>.+)" }], destination: "/places/:lab", permanent: false },
      { source: "/lab-states", destination: "/places", permanent: false },
      // The admin's Overview became the admin block on Home.
      { source: "/admin/dashboard", destination: "/home", permanent: false },
    ];
  },

  async headers() {
    // Only with ?v=: an unversioned URL must never be pinned for a year.
    return [{ source: "/help/:path+", has: [{ type: "query", key: "v" }], headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;
