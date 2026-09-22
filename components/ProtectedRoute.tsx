"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import ForcedPasswordChange from "@/components/ForcedPasswordChange";

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
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
