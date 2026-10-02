"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "../../lib/theme-context";
import { useAuth, useNavFacts } from "../../lib/auth-context";
import { YOU_GROUP, canAccessPath } from "../../lib/nav";
import { helpChaptersFor, helpHrefFor } from "../../lib/help/audience";
import { ROLE_LABEL, type RoleKind } from "@/lib/shared";
import Bell from "./Bell";
import NavIcon from "./NavIcon";
import { ChevronDown, CircleHelp, LogOut, Menu, Moon, Search, Sun } from "lucide-react";

function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w));
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/**
 * The avatar opens the person's own corner — Help & guides, Profile & password, and
 * Sign out — where people look for them. The panel is fixed-positioned because the top
 * bar clips its overflow (same as the bell).
 */
function UserMenu({ name, roles }: { name: string | null; roles: RoleKind[] }) {
  const router = useRouter();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const roleLine = roles.map((r) => ROLE_LABEL[r]).join(" · ");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const itemCls = "w-full border-0 bg-transparent text-left text-12 text-text px-12 py-7 flex items-center gap-8 hover:bg-panel3 cursor-pointer";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Your account"
        title="Your account"
        className="flex items-center gap-7 md:pl-8 md:border-l border-0 border-solid border-topline bg-transparent text-current h-26 flex-none cursor-pointer hover:opacity-90"
      >
        <span className="w-22 h-22 rounded-full bg-topline flex items-center justify-center text-11 font-semibold flex-none">
          {name ? initials(name) : "··"}
        </span>
        <span className="leading-tight text-left hidden lg:block">
          <span className="block text-11 font-medium whitespace-nowrap">{name ?? "…"}</span>
          <span className="block text-10.5 opacity-60 whitespace-nowrap">{roleLine}</span>
        </span>
        <ChevronDown size={12} aria-hidden="true" className="opacity-80 flex-none" />
      </button>

      {open && (
        <div ref={panelRef} role="menu" aria-label="Your account" className="fixed right-8 top-38 z-50 w-230 bg-panel text-text border border-border2 rounded-4 py-4">
          <div className="px-12 py-7 border-b border-border mb-4 lg:hidden">
            <div className="text-12 font-semibold">{name ?? "…"}</div>
            <div className="text-11 text-dim">{roleLine}</div>
          </div>
          {YOU_GROUP.items.map((item) => (
            <Link key={item.key} role="menuitem" href={item.path} onClick={() => setOpen(false)} style={{ textDecoration: "none" }} className={itemCls}>
              <span className="text-dim flex">
                <NavIcon name={item.icon} />
              </span>
              {item.label}
            </Link>
          ))}
          <div className="border-t border-border my-4" />
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void logout().then(() => router.replace("/login"));
            }}
            className={itemCls}
          >
            <LogOut size={14} strokeWidth={1.75} aria-hidden="true" className="text-dim flex-none" />
            Sign out
          </button>
        </div>
      )}
    </>
  );
}

export default function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { theme, toggle } = useTheme();
  const { user, me } = useAuth();
  const pathname = usePathname();
  // Help opens on the guide section for this screen and this person's role.
  const helpHref = helpHrefFor(pathname, helpChaptersFor(me));
  const router = useRouter();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // The box searches the register, so it only shows for people who may open it.
  const facts = useNavFacts();
  const canSearch = canAccessPath("/register", facts);

  // Ctrl/⌘+K jumps to the box from anywhere.
  useEffect(() => {
    if (!canSearch) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSearch]);

  // Enter opens the register's search list with the same query (so @key:value terms work).
  function search() {
    const q = query.trim();
    if (!q) return;
    router.push(`/register?mode=flat&q=${encodeURIComponent(q)}`);
    inputRef.current?.blur();
  }

  return (
    <div className="bg-top text-topfg flex items-center gap-8 md:gap-12 px-8 md:px-10 flex-none min-w-0 overflow-hidden">
      {/* Drawer trigger — only below md, where the sidebar is off-canvas. 32px tall so it
          stays a comfortable target on a phone even though the bar itself is 38px. */}
      <button
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="md:hidden border border-topline2 bg-topfill2 text-current w-30 h-26 rounded-3 text-13 flex items-center justify-center flex-none"
      >
        <Menu size={16} aria-hidden="true" />
      </button>

      <div className="flex items-center gap-8 min-w-0 shrink overflow-hidden">
        <div className="w-18 h-18 bg-white text-top text-10.5 font-bold flex items-center justify-center tracking-tight rounded-2 flex-none">
          AS
        </div>
        <div className="text-12 font-semibold tracking-wide whitespace-nowrap">
          ASTU <span className="opacity-60 font-normal hidden sm:inline">Lab Resources</span>
        </div>
      </div>

      <div className="flex-1 min-w-0 hidden md:flex justify-center px-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
          className={`w-full min-w-0 max-w-[380px] relative items-center bg-topfill border border-topline rounded-3 h-24 px-8 gap-6 ${canSearch ? "flex" : "hidden"}`}
        >
          <Search size={12} className="opacity-60 flex-none" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                inputRef.current?.blur();
              }
            }}
            aria-label="Search the register"
            placeholder="Find an asset, tag, catalog item, lab…"
            className="flex-1 bg-transparent border-0 outline-none text-11.5 text-current min-w-0"
          />
          <span className="text-10.5 opacity-45 font-mono border border-topline2 rounded-2 px-4 flex-none" title="Ctrl+K or ⌘K">⌘K</span>
        </form>
      </div>

      <div className="flex-1 md:hidden" />

      <Bell />

      <Link
        href={helpHref}
        title="Help for this page"
        aria-label="Help for this page"
        style={{ textDecoration: "none" }}
        className={`border border-topline2 h-26 md:h-24 px-8 md:px-9 rounded-3 text-11 flex items-center gap-5 flex-none ${pathname === "/help" ? "bg-topsel text-top" : "bg-topfill2 text-current"}`}
      >
        <CircleHelp size={13} aria-hidden="true" />
        <span className="opacity-70 hidden lg:inline">Help</span>
      </Link>

      <button
        onClick={toggle}
        title="Toggle theme"
        aria-label="Toggle theme"
        className="border border-topline2 bg-topfill2 text-current h-26 md:h-24 px-8 md:px-9 rounded-3 text-11 flex items-center gap-5 flex-none"
      >
        {theme === "light" ? <Sun size={13} aria-hidden="true" /> : <Moon size={13} aria-hidden="true" />}
        <span className="opacity-70 hidden lg:inline">{theme === "light" ? "Light" : "Dark"}</span>
      </button>

      <UserMenu name={user?.name ?? null} roles={user?.roles ?? []} />
    </div>
  );
}
