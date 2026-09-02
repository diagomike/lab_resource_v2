"use client";

import type { ReactNode } from "react";
import { useTheme } from "../lib/theme-context";

/**
 * Shared chrome for every logged-out screen (sign in, accept invite, forgot/reset
 * password) — the ASTU top bar with a theme toggle even while signed out, and a
 * centered card below it. Ported from the sister feedback system's LoginPage/
 * RegisterPage pattern: signing in should feel like the front door of the system, not a
 * separate bare page, and the previous plain-centered layout gave nobody a chance to
 * fix a bad theme before they'd even signed in.
 */
export default function AuthChrome({
  subtitle,
  children,
  footer,
}: {
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="h-38 bg-top text-topfg flex items-center gap-12 px-10 flex-none">
        <div className="flex items-center gap-8">
          <div className="w-18 h-18 bg-white text-top text-9.5 font-bold flex items-center justify-center tracking-tight rounded-2">
            AS
          </div>
          <div className="text-12 font-semibold tracking-wide">
            ASTU <span className="opacity-60 font-normal">Lab Resources</span>
          </div>
        </div>
        <div className="flex-1" />
        <button
          onClick={toggle}
          title="Toggle theme"
          className="border border-topline2 bg-topfill2 text-current h-24 px-9 rounded-3 text-11 flex items-center gap-5"
        >
          {theme === "light" ? "◐" : "◑"}
          <span className="opacity-70">{theme === "light" ? "Light" : "Dark"}</span>
        </button>
      </div>

      <div className="flex-1 flex items-start justify-center pt-64 px-14">
        <div className="w-full max-w-[380px]">
          <div className="bg-panel border border-border rounded-3 overflow-hidden">
            <div className="px-14 py-12 border-b border-border">
              <div className="text-10 uppercase tracking-caps text-faint font-semibold">
                Adama Science and Technology University
              </div>
              <div className="text-15 font-semibold mt-2">{subtitle}</div>
            </div>
            {children}
          </div>
          {footer && <div className="text-10.5 text-faint leading-loose mt-12 px-2">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
