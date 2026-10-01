"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { navFor, screenKeyForPath } from "../../lib/nav";
import { useAuth, useNavFacts } from "../../lib/auth-context";
import { useHomeCounts } from "../../lib/home-counts";
import { SCOPE_LABEL, type HomeCountsDto, type ScopeDto } from "@/lib/shared";

/** "The whole university · 14 units" or "3 units" — plain words, no internal levels. */
function scopeMeta(scope: ScopeDto): string {
  const units = `${scope.reachableNodeCount} unit${scope.reachableNodeCount === 1 ? "" : "s"}`;
  return scope.isGlobal ? `The whole university · ${units}` : units;
}

/** Which sidebar entry shows which count — what is waiting there for this person. */
const BADGE: Record<string, keyof HomeCountsDto> = { approvals: "approvals", purchasing: "purchasing", places: "places", "external-requests": "outside" };

export default function Sidebar({
  scope,
  onNavigate,
}: {
  scope: ScopeDto | null;
  /** Called after any navigation so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, logout } = useAuth();
  const facts = useNavFacts();
  const { counts } = useHomeCounts();
  const isAdmin = facts.roles.includes("SYS_ADMIN");
  const activeKey = screenKeyForPath(pathname);

  return (
    <div className="bg-panel2 md:border-r border-border flex flex-col min-h-0 h-full overflow-hidden">
      <div className="px-12 pt-9 pb-8 border-b border-border flex-none">
        <div className="text-9.5 uppercase tracking-label text-faint font-semibold">Your scope</div>
        {scope ? (
          <>
            <div className="flex items-center gap-6 mt-4">
              <div className="w-6 h-6 bg-accent rounded-1 flex-none" />
              <div className="text-12 font-semibold leading-snug">{scope.name}</div>
            </div>
            <div className="text-10.5 text-dim mt-2 font-mono">{scopeMeta(scope)}</div>
          </>
        ) : isAdmin ? (
          // The system admin holds no node on purpose — SYS_ADMIN already grants sight of
          // every node, so giving them one would add a phantom level to the org chart.
          <>
            <div className="flex items-center gap-6 mt-4">
              <div className="w-6 h-6 bg-accent rounded-1 flex-none" />
              <div className="text-12 font-semibold leading-snug">Entire university</div>
            </div>
            <div className="text-10.5 text-dim mt-2 font-mono">system administrator</div>
          </>
        ) : (
          // Custodians, instructors and students occupy no org node. They are not
          // accountable for a unit's register — they keep, use or borrow individual
          // items — and saying so plainly beats an empty panel.
          <div className="text-10.5 text-faint mt-4 leading-normal">
            No unit scope — you work with the individual resources assigned to you.
          </div>
        )}

        {/* How the resource register resolves for this person specifically — distinct
            from the org-hierarchy scope above (a MY_CUSTODY custodian has no node of
            their own, but still has a resource scope). */}
        {me && (
          <div className="text-10.5 text-dim mt-6 flex items-center gap-5">
            <span className="opacity-60">◎</span>
            {SCOPE_LABEL[me.scopeMode]}
          </div>
        )}

      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-6 pb-10">
        {navFor(facts).map((group) => (
          <div key={group.label} className="mb-9">
            <div className="text-9.5 uppercase tracking-label text-faint font-semibold px-12 pt-4 pb-3">
              {group.label}
            </div>
            {group.items.map((item) => {
              const on = item.key === activeKey;
              const n = BADGE[item.key] && counts ? counts[BADGE[item.key]] : 0;
              const count = n > 0 ? String(n) : "";
              return (
                <Link
                  key={item.key}
                  href={item.path}
                  onClick={() => onNavigate?.()}
                  aria-current={on ? "page" : undefined}
                  title={count ? `${item.label}: ${count} waiting for you` : undefined}
                  style={{
                    textDecoration: "none",
                    borderLeftColor: on ? "var(--accent)" : "transparent",
                    background: on ? "var(--sel)" : "transparent",
                    color: on ? "var(--text)" : "var(--dim)",
                    fontWeight: on ? 600 : 400,
                  }}
                  className="w-full text-left border-0 border-l-2 border-solid text-12 pl-10 pr-12 py-6 md:py-4 flex items-center gap-7 leading-relaxed hover:bg-panel3"
                >
                  <span className="w-13 text-center text-10 opacity-75 flex-none">{item.icon}</span>
                  <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{item.label}</span>
                  {count && (
                    <span className="text-9.5 font-semibold font-mono px-5 rounded-full bg-accent text-white leading-relaxed" aria-hidden="true">
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-border py-6 flex-none">
        <button
          onClick={() => void logout().then(() => router.replace("/login"))}
          className="w-full text-left border-0 bg-transparent text-dim text-11.5 px-12 py-6 md:py-4 flex items-center gap-7 hover:bg-panel3 hover:text-text"
        >
          <span className="w-13 text-center text-10 opacity-75">⏻</span>Sign out
        </button>
      </div>
    </div>
  );
}
