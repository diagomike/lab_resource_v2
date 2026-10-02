"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PublicCatalogDto } from "@/lib/shared";
import { ApiError } from "@/lib/api";
import { loadPublicCatalog } from "@/lib/portal-catalog";
import PortalChrome from "@/components/portal/PortalChrome";
import { Panel, ErrorNote } from "@/components/ui";
import { PanelLoading } from "@/components/states";
import { CategoryIcon } from "@/components/resources/IconPicker";

/** Public — what the university can offer, as counts only, and the way in to ask (an
 *  account, since 2026-09-28). */
export default function PortalHome() {
  const [catalog, setCatalog] = useState<PublicCatalogDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPublicCatalog()
      .then(setCatalog)
      .catch((e) => setError(e instanceof ApiError ? e.message : "The catalog is unavailable right now."));
  }, []);

  return (
    <PortalChrome>
      <div className="flex flex-col gap-6">
        <h1 className="text-21 font-semibold">Hosting a workshop, or need samples analysed?</h1>
        <p className="text-12 text-dim leading-relaxed max-w-[640px]">
          Adama Science and Technology University makes its laboratories, workstations and machines available to institutions and companies: to use for a
          workshop or training, or to run your samples and give you the results. Below is what we have across campus. Create an account, tell us what you
          need and when, attach your official letter, and we will reply with a quote.
        </p>
        <div className="flex flex-wrap items-center gap-10">
          <Link href="/portal/signup" className="inline-flex items-center border border-accent bg-accent text-white h-28 px-14 rounded-2 text-12 font-medium">
            Create an account
          </Link>
          <Link href="/portal/requests" className="text-12 text-accent">
            Already have one? Your requests
          </Link>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!catalog && !error ? (
        <Panel>
          <PanelLoading rows={5} />
        </Panel>
      ) : catalog && catalog.groups.length === 0 ? (
        <Panel>
          <div className="px-14 py-14 text-11.5 text-dim">The catalog is being prepared. You can still send a request describing what you need.</div>
        </Panel>
      ) : (
        catalog?.groups.map((g) => (
          <Panel key={g.name} title={g.name}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
              {g.categories.map((c) => (
                <div key={c.id} className="flex items-center gap-10 px-14 py-12 border-b border-r border-border">
                  <CategoryIcon iconKey={c.iconKey} className="size-20 text-dim" />
                  <div>
                    <div className="text-17 font-semibold font-mono">
                      {c.count.toLocaleString()}
                      {c.unit ? <span className="text-11 text-dim font-sans"> {c.unit}</span> : null}
                    </div>
                    <div className="text-11 text-dim">{c.name}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        ))
      )}
    </PortalChrome>
  );
}
