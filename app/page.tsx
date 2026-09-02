"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { landingPathFor } from "@/lib/nav";
import { SessionCheck } from "@/components/states";

/** Sends each role to their workspace's first screen: an admin to personnel, everyone
 *  else to their workspace's placeholder until it is built. */
export default function LandingRedirect() {
  const { me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(me ? landingPathFor(me.workspace, me.user.roles) : "/login");
  }, [loading, me, router]);

  return <SessionCheck />;
}
