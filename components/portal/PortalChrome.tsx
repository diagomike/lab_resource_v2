"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTheme } from "@/lib/theme-context";

/**
 * The public portal's frame — the same ASTU top bar as the sign-in screens (AuthChrome),
 * but a wide content column instead of a narrow card, since the catalog and request form
 * are pages, not dialogs. No session, no sidebar.
 */
export default function PortalChrome({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="h-38 bg-top text-topfg flex items-center gap-12 px-10 flex-none">
        <Link href="/portal" className="flex items-center gap-8">
          <div className="w-18 h-18 bg-white text-top text-9.5 font-bold flex items-center justify-center tracking-tight rounded-2">AS</div>
          <div className="text-12 font-semibold tracking-wide">
            ASTU <span className="opacity-60 font-normal">Resources for workshops &amp; training</span>
          </div>
        </Link>
        <div className="flex-1" />
        <button onClick={toggle} title="Toggle theme" className="border border-topline2 bg-topfill2 text-current h-24 px-9 rounded-3 text-11 flex items-center gap-5">
          {theme === "light" ? "◐" : "◑"}
        </button>
      </div>
      <div className="flex-1 px-14 py-20">
        <div className="w-full max-w-[860px] mx-auto flex flex-col gap-14">{children}</div>
      </div>
      <div className="px-14 py-12 text-10.5 text-faint text-center">Adama Science and Technology University · Office of the Academic Vice President</div>
    </div>
  );
}
