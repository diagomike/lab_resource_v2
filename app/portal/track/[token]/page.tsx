"use client";

import Link from "next/link";
import PortalChrome from "@/components/portal/PortalChrome";
import { Panel } from "@/components/ui";

/** Tracking links from before requester accounts (2026-09-28) — requests are followed
 *  signed in now. Signing up with the same email address attaches earlier requests. */
export default function PortalTrackPage() {
  return (
    <PortalChrome>
      <Panel title="Follow your request in your account">
        <div className="px-14 py-14 text-12 flex flex-col gap-8">
          <div>
            Requests are followed signed in now.{" "}
            <Link href="/login" className="text-accent underline">
              Sign in
            </Link>{" "}
            — or{" "}
            <Link href="/portal/signup" className="text-accent underline">
              create an account
            </Link>{" "}
            with the email address you used for your request, and it will be there.
          </div>
        </div>
      </Panel>
    </PortalChrome>
  );
}
