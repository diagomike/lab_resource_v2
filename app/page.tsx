"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { landingPathFor } from "@/lib/nav";
import { SessionCheck } from "@/components/states";

/** Sends everyone to Home (an outside requester to the portal): what they see there
 *  is what is waiting for them. */
export default function LandingRedirect() {
  const { me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(me ? landingPathFor(me.user.roles) : "/login");
  }, [loading, me, router]);

  return <SessionCheck />;
}
