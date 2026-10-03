"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import NavIcon from "./NavIcon";
import { usePathname } from "next/navigation";
import { navFor, screenKeyForPath } from "../../lib/nav";
import { useAuth, useNavFacts } from "../../lib/auth-context";
import { useHomeCounts } from "../../lib/home-counts";
import { SCOPE_LABEL, type CountArea, type ScopeDto } from "@/lib/shared";
import { CountChips } from "@/components/ui";

/** "The whole university · 14 units" or "3 units" — plain words, no internal levels. */
function scopeMeta(scope: ScopeDto): string {
  const units = `${scope.reachableNodeCount} unit${scope.reachableNodeCount === 1 ? "" : "s"}`;
  return scope.isGlobal ? `The whole university · ${units}` : units;
}

/** Which sidebar entry shows which area's counts: what waits there for this person, and
 *  what of theirs is still moving. */
const BADGE: Record<string, CountArea> = { approvals: "approvals", purchasing: "purchasing", places: "places", "external-requests": "outside", schedule: "bookings" };

export default function Sidebar({
  scope,
  onNavigate,
}: {
  scope: ScopeDto | null;
  /** Called after any navigation so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { me } = useAuth();
  const facts = useNavFacts();
  const { counts, refresh } = useHomeCounts();
  const isAdmin = facts.roles.includes("SYS_ADMIN");
  const activeKey = screenKeyForPath(pathname);
  // Opening an area reads its bad news (declined, sent back): its red badge clears. Only
  // on arriving there, so a decline that lands while the page is open still shows.
  const declinedHere = BADGE[activeKey] && counts ? counts.areas[BADGE[activeKey]].declined : 0;
  const declinedRef = useRef(0);
  declinedRef.current = declinedHere;
  useEffect(() => {
    const area = BADGE[activeKey];
    if (!area) return;
    const timer = window.setTimeout(() => {
      if (!declinedRef.current) return;
      api.post("/notifications/read", { declinedInArea: area }).then(refresh, () => {});
    }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  return (
    <div className="bg-panel2 md:border-r border-border flex flex-col min-h-0 h-full overflow-hidden">
      <div className="px-12 pt-9 pb-8 border-b border-border flex-none">
        <div className="text-10.5 uppercase tracking-label text-faint font-semibold">Your scope</div>
        {scope ? (
          <>
            <div className="flex items-center gap-6 mt-4">
              <div className="w-6 h-6 bg-accent rounded-1 flex-none" />
              <div className="text-12 font-semibold leading-snug">{scope.name}</div>
            </div>
            <div className="text-11 text-dim mt-2 font-mono">{scopeMeta(scope)}</div>
          </>
        ) : isAdmin ? (
          // The system admin holds no node on purpose — SYS_ADMIN already grants sight of
          // every node, so giving them one would add a phantom level to the org chart.
          <>
            <div className="flex items-center gap-6 mt-4">
              <div className="w-6 h-6 bg-accent rounded-1 flex-none" />
              <div className="text-12 font-semibold leading-snug">Entire university</div>
            </div>
            <div className="text-11 text-dim mt-2 font-mono">system administrator</div>
          </>
        ) : (
          // Custodians, instructors and students occupy no org node. They are not
          // accountable for a unit's register — they keep, use or borrow individual
          // items — and saying so plainly beats an empty panel.
          <div className="text-11 text-faint mt-4 leading-normal">
            No unit scope. You work with the individual resources assigned to you.
          </div>
        )}

        {/* How the resource register resolves for this person specifically — distinct
            from the org-hierarchy scope above (a MY_CUSTODY custodian has no node of
            their own, but still has a resource scope). */}
        {me && (
          <div className="text-11 text-dim mt-6 flex items-center gap-5">
                        {SCOPE_LABEL[me.scopeMode]}
          </div>
        )}

      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-6 pb-10">
        {navFor(facts).map((group) => (
          <div key={group.label} className="mb-9">
            <div className="text-10.5 uppercase tracking-label text-faint font-semibold px-12 pt-4 pb-3">
              {group.label}
            </div>
            {group.items.map((item) => {
              const on = item.key === activeKey;
              const area = BADGE[item.key] && counts ? counts.areas[BADGE[item.key]] : null;
              const words = area
                ? [area.declined ? `${area.declined} declined or sent back` : "", area.action ? `${area.action} waiting for you` : "", area.following ? `${area.following} in progress` : ""].filter(Boolean).join(", ")
                : "";
              return (
                <Link
                  key={item.key}
                  href={item.path}
                  onClick={() => onNavigate?.()}
                  aria-current={on ? "page" : undefined}
                  title={words ? `${item.label}: ${words}` : undefined}
                  style={{
                    textDecoration: "none",
                    borderLeftColor: on ? "var(--accent)" : "transparent",
                    background: on ? "var(--sel)" : "transparent",
                    color: on ? "var(--text)" : "var(--dim)",
                    fontWeight: on ? 600 : 400,
                  }}
                  className="w-full text-left border-0 border-l-2 border-solid text-12 pl-10 pr-12 py-6 md:py-4 flex items-center gap-7 leading-relaxed hover:bg-panel3"
                >
                  <NavIcon name={item.icon} />
                  <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
                  {area && <CountChips action={area.action} following={area.following} declined={area.declined} />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
