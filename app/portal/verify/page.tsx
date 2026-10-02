"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import PortalChrome from "@/components/portal/PortalChrome";
import { Panel, ErrorNote } from "@/components/ui";

/** Public — the emailed link that confirms a requester account's email address. */
function VerifyInner() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<{ done: boolean; error: string | null }>({ done: false, error: null });
  // The link works once; development's double-run of effects must not spend it twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setState({ done: false, error: "This link is incomplete. Open it straight from the email." });
      return;
    }
    api
      .post("/public/verify-email", { token })
      .then(() => setState({ done: true, error: null }))
      .catch((e) => setState({ done: false, error: e instanceof ApiError ? e.message : "This link could not be checked." }));
  }, [token]);

  return (
    <PortalChrome>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {!state.error && (
        <Panel title={state.done ? "Email confirmed" : "Confirming…"}>
          <div className="px-14 py-14 text-12">
            {state.done ? (
              <>
                Your account is ready.{" "}
                <Link href="/login" className="text-accent underline">
                  Sign in
                </Link>{" "}
                to send a request.
              </>
            ) : (
              <span className="text-faint">One moment…</span>
            )}
          </div>
        </Panel>
      )}
    </PortalChrome>
  );
}

/** useSearchParams needs a Suspense boundary in the Next.js App Router. */
export default function PortalVerifyPage() {
  return (
    <Suspense>
      <VerifyInner />
    </Suspense>
  );
}
