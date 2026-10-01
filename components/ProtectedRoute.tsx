"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import ForcedPasswordChange from "@/components/ForcedPasswordChange";
import { loginHref } from "@/lib/paths";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Arriving signed out: after signing in, come back to exactly this page (an emailed
  // link, a bookmark). Signing out here on purpose just goes to sign-in. (A session that
  // ends mid-use is caught by lib/api.ts, which keeps the page.)
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (user) wasSignedIn.current = true;
    if (!loading && !user) router.replace(wasSignedIn.current ? "/login" : loginHref());
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="h-screen w-full bg-bg flex items-center justify-center text-11.5 text-faint">
        Checking your session…
      </div>
    );
  }
  // A temporary password set by an administrator: nothing else renders (and the server
  // refuses every other call) until the person chooses their own.
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  return <>{children}</>;
}
