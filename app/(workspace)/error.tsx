"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Screen } from "@/components/ui";

/** A screen that broke while drawing: say so plainly, offer to try again, keep the shell
 *  (sidebar, bell) working around it. */
export default function WorkspaceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Screen>
      <div className="flex gap-10 max-w-[560px]">
        <div className="w-3 bg-bad rounded-2 flex-none" />
        <div>
          <h1 className="text-14 font-semibold text-text m-0">This screen ran into a problem</h1>
          <p className="text-11.5 text-dim leading-loose mt-3 mb-0">
            Nothing you saved was lost. Try again; if it keeps happening, tell the system administrator what you were doing
            {error.digest ? (
              <>
                {" "}
                and quote <span className="font-mono text-text">{error.digest}</span>
              </>
            ) : null}
            .
          </p>
          <div className="flex items-center gap-10 mt-10">
            <button type="button" onClick={() => retry()} className="border border-accent bg-accent text-white h-28 px-12 rounded-2 text-11.5 font-medium">
              Try again
            </button>
            <Link href="/home" className="text-11.5">
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    </Screen>
  );
}
