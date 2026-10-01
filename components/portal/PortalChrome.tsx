"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/lib/theme-context";
import { useAuth } from "@/lib/auth-context";
import { loginHref } from "@/lib/paths";

/**
 * The portal's frame — the same ASTU top bar as the sign-in screens (AuthChrome), but a
 * wide content column instead of a narrow card, since the catalog and request form are
 * pages, not dialogs. No sidebar. Signed in (a requester's own pages), it names the
 * account and offers their requests and sign-out; on the public pages, sign-in and sign-up.
 */
export default function PortalChrome({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const router = useRouter();
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <div className="h-38 bg-top text-topfg flex items-center gap-12 px-10 flex-none">
        {/* text-current: the global link colour made the title blue-on-blue in the top bar. */}
        <Link href="/portal" className="flex items-center gap-8 text-current no-underline">
          <div className="w-18 h-18 bg-white text-top text-9.5 font-bold flex items-center justify-center tracking-tight rounded-2">AS</div>
          <div className="text-12 font-semibold tracking-wide">
            ASTU <span className="opacity-60 font-normal hidden sm:inline">Resources for workshops, training &amp; analysis</span>
          </div>
        </Link>
        <div className="flex-1" />
        {user ? (
          <>
            <Link href="/portal/requests" className="text-11 text-current no-underline hidden sm:inline">
              My requests
            </Link>
            <span className="text-11 opacity-70 hidden md:inline">{user.organisation ?? user.name}</span>
            <button
              onClick={async () => {
                await logout();
                router.replace("/portal");
              }}
              className="border border-topline2 bg-topfill2 text-current h-24 px-9 rounded-3 text-11"
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="text-11 text-current no-underline">
              Sign in
            </Link>
            <Link href="/portal/signup" className="border border-topline2 bg-topfill2 text-current h-24 px-9 rounded-3 text-11 flex items-center no-underline">
              Create account
            </Link>
          </>
        )}
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

/** A requester's own pages: signed in with an outside requester's (EXTERNAL) account. */
export function RequireRequester({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace(loginHref());
  }, [loading, user, router]);
  if (loading || !user) {
    return (
      <PortalChrome>
        <div className="text-11.5 text-faint">Checking your session…</div>
      </PortalChrome>
    );
  }
  if (!user.roles.includes("EXTERNAL")) {
    return (
      <PortalChrome>
        <div className="text-12">
          These pages are for outside institutions' requester accounts. University staff follow external requests under{" "}
          <Link href="/external-requests" className="text-accent underline">
            External requests
          </Link>
          .
        </div>
      </PortalChrome>
    );
  }
  return <>{children}</>;
}
