"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { MeContextDto, SessionUserDto } from "@/lib/shared";
import { api, ApiError } from "./api";

interface AuthState {
  user: SessionUserDto | null;
  /** The full /auth/me payload — scope, scopeMode, views, canSeeCost. Kept here rather
   *  than re-fetched by AppShell separately: the shell used to run its own independent
   *  /auth/me call for exactly this, which meant every page load hit the same endpoint
   *  twice for no reason. AppShell's useMeContext() now just reads this. */
  me: MeContextDto | null;
  loading: boolean;
  /** Resolves with the full context so the caller can route without waiting for the
   *  context state to settle — see landingPathFor(roles). */
  login: (email: string, password: string) => Promise<MeContextDto>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/** F-057: the public portal is for signed-out outsiders — probing /auth/me from it only
 *  produced a 401 per visit. */
const isPublicPath = (pathname: string | null) => pathname === "/portal" || (pathname?.startsWith("/portal/") ?? false);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeContextDto | null>(null);
  const [loading, setLoading] = useState(true);
  const publicPage = isPublicPath(usePathname());

  // `loading` exists because session validation is async on mount: every authenticated
  // screen therefore has an initial indeterminate state, which the shell renders as a
  // content-pane SessionCheck rather than a full-page spinner.
  useEffect(() => {
    if (publicPage) {
      setLoading(false);
      return;
    }
    // Arriving from the portal (client-side navigation) starts a fresh session check.
    setLoading(true);
    api
      .get<MeContextDto>("/auth/me")
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, [publicPage]);

  async function login(email: string, password: string): Promise<MeContextDto> {
    // /auth/login itself only returns the session user (see auth.controller.ts) — scope
    // and scopeMode need the org/scope lookups /auth/me already does, so this makes
    // that one extra call rather than duplicating that logic client-side.
    await api.post<SessionUserDto>("/auth/login", { email, password });
    const ctx = await api.get<MeContextDto>("/auth/me");
    setMe(ctx);
    return ctx;
  }

  async function logout() {
    // The cookie is cleared server-side regardless of whether this call succeeds — never
    // leave the client believing it's still signed in over a network hiccup or an
    // unexpected response shape from /auth/logout.
    try {
      await api.post("/auth/logout");
    } finally {
      setMe(null);
    }
  }

  return <AuthContext.Provider value={{ user: me?.user ?? null, me, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
