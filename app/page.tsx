"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { landingPathFor } from "@/lib/nav";
import { SessionCheck } from "@/components/states";

/** Sends everyone to the same first screen — the resource dashboard. What they see
 *  there differs by scope, not by which page they land on. */
export default function LandingRedirect() {
  const { me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(me ? landingPathFor(me.user.roles) : "/login");
  }, [loading, me, router]);

  return <SessionCheck />;
}
