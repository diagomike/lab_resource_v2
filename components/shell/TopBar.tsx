"use client";

import { useTheme } from "../../lib/theme-context";
import { useAuth } from "../../lib/auth-context";

function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w));
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export default function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { theme, toggle } = useTheme();
  const { user } = useAuth();
  const roles = user?.roles ?? [];

  return (
    <div className="bg-top text-topfg flex items-center gap-8 md:gap-12 px-8 md:px-10 flex-none min-w-0 overflow-hidden">
      {/* Drawer trigger — only below md, where the sidebar is off-canvas. 32px tall so it
          stays a comfortable target on a phone even though the bar itself is 38px. */}
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="md:hidden border border-topline2 bg-topfill2 text-current w-30 h-26 rounded-3 text-13 flex items-center justify-center flex-none"
      >
        ☰
      </button>

      <div className="flex items-center gap-8 min-w-0 shrink overflow-hidden">
        <div className="w-18 h-18 bg-white text-top text-9.5 font-bold flex items-center justify-center tracking-tight rounded-2 flex-none">
          AS
        </div>
        <div className="text-12 font-semibold tracking-wide whitespace-nowrap">
          ASTU <span className="opacity-60 font-normal hidden sm:inline">Lab Resources</span>
        </div>
      </div>

      <div className="flex-1 min-w-0 hidden md:flex justify-center px-8">
        <div className="w-full min-w-0 max-w-[380px] relative flex items-center bg-topfill border border-topline rounded-3 h-24 px-8 gap-6">
          <span className="text-10 opacity-60">⌕</span>
          <input
            placeholder="Find an asset, tag, catalog item, lab…"
            className="flex-1 bg-transparent border-0 outline-none text-11.5 text-current min-w-0"
          />
          <span className="text-9.5 opacity-45 font-mono border border-topline2 rounded-2 px-4 flex-none">⌘K</span>
        </div>
      </div>

      <div className="flex-1 md:hidden" />

      <button
        onClick={toggle}
        title="Toggle theme"
        aria-label="Toggle theme"
        className="border border-topline2 bg-topfill2 text-current h-26 md:h-24 px-8 md:px-9 rounded-3 text-11 flex items-center gap-5 flex-none"
      >
        {theme === "light" ? "◐" : "◑"}
        <span className="opacity-70 hidden lg:inline">{theme === "light" ? "Light" : "Dark"}</span>
      </button>

      <div className="flex items-center gap-7 md:pl-8 md:border-l border-topline flex-none">
        <div className="w-22 h-22 rounded-full bg-topline flex items-center justify-center text-10 font-semibold flex-none">
          {user ? initials(user.name) : "··"}
        </div>
        <div className="leading-tight pr-4 hidden lg:block">
          <div className="text-11 font-medium whitespace-nowrap">{user?.name ?? "…"}</div>
          <div className="text-9.5 opacity-60 whitespace-nowrap">
            {roles.map((r) => r.toLowerCase()).join(" · ")}
          </div>
        </div>
      </div>
    </div>
  );
}
