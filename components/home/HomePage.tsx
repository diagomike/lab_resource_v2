"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HomeDto, NotificationDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { useHomeCounts } from "@/lib/home-counts";
import { timeAgo } from "@/components/shell/Bell";
import { InlineError, PanelLoading } from "@/components/states";
import { Panel, Screen, Tag } from "@/components/ui";

/**
 * Home — everyone's landing page. One next step at the top (the single most useful
 * thing to do now), then what is waiting, what was left unfinished, where your own
 * requests stand, and what is new. Facts: lib/server/home/home.ts; the choice of next
 * step: lib/domain/home-logic.ts.
 */

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** A row that opens something: the whole row is the link. */
function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} style={{ textDecoration: "none" }} className="flex items-center gap-10 px-14 py-9 border-b border-border last:border-b-0 text-text hover:bg-panel3">
      {children}
      <span className="text-faint text-11 flex-none" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <div className="px-14 py-12 text-11.5 text-dim leading-loose">{children}</div>;
}

function NextStepBanner({ step }: { step: HomeDto["nextStep"] }) {
  if (!step) {
    return (
      <div className="flex gap-12 bg-goodbg border border-good rounded-3 px-14 py-12">
        <div className="w-3 bg-good rounded-2 flex-none" />
        <div>
          <div className="text-13 font-semibold text-text">You&apos;re all caught up</div>
          <div className="text-11.5 text-dim leading-loose mt-2">Nothing is waiting for you. When something needs you, it shows here and under the bell.</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-12 bg-soft border border-accent rounded-3 px-14 py-12">
      <div className="flex gap-12 flex-1 min-w-0">
        <div className="w-3 bg-accent rounded-2 flex-none" />
        <div className="min-w-0">
          <div className="text-10.5 uppercase tracking-label text-accent font-semibold">Next step</div>
          <div className="text-14 font-semibold text-text leading-snug mt-3">{step.title}</div>
          {step.body && <div className="text-11.5 text-dim leading-loose mt-2">{step.body}</div>}
        </div>
      </div>
      <Link
        href={step.path}
        style={{ textDecoration: "none" }}
        className="self-start sm:self-auto border border-accent bg-accent text-white h-28 px-14 rounded-3 text-12 font-medium flex items-center whitespace-nowrap flex-none"
      >
        {step.action}
      </Link>
    </div>
  );
}

function RecentList({ items, onOpen }: { items: NotificationDto[]; onOpen: (n: NotificationDto) => void }) {
  if (!items.length) return <Quiet>Nothing yet. Decisions on your requests and things sent to you show here.</Quiet>;
  return (
    <div>
      {items.map((n) => (
        <button
          key={n.id}
          onClick={() => onOpen(n)}
          className="w-full text-left border-0 border-b border-border last:border-b-0 bg-transparent px-14 py-9 flex gap-8 cursor-pointer hover:bg-panel3"
        >
          <span className={`w-6 h-6 rounded-full mt-5 flex-none ${n.read ? "bg-transparent" : "bg-accent"}`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className={`block text-11.5 leading-snug ${n.read ? "text-dim" : "text-text font-medium"}`}>{n.title}</span>
            <span className="block text-11 text-faint mt-2">
              {n.actorName ? `${n.actorName} · ` : ""}
              {timeAgo(n.createdAt)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="flex-1 min-w-[110px] px-14 py-10 border-r border-border last:border-r-0">
      <div className="text-10.5 uppercase tracking-label text-faint font-semibold">{label}</div>
      <div className={`text-19 font-semibold font-mono mt-3 ${tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-text"}`}>{value}</div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { refresh: refreshCounts } = useHomeCounts();
  const [home, setHome] = useState<HomeDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.get<HomeDto>("/home").then(
      (h) => {
        setHome(h);
        refreshCounts();
      },
      (err) => setError(err instanceof ApiError ? err.message : "Home could not be loaded."),
    );
  }, [refreshCounts]);

  useEffect(() => {
    load();
  }, [load]);

  async function openNotice(n: NotificationDto) {
    if (!n.read) await api.post("/notifications/read", { ids: [n.id] }).catch(() => {});
    refreshCounts();
    router.push(n.path);
  }

  if (error) {
    return (
      <Screen>
        <Panel>
          <InlineError message={error} onRetry={load} />
        </Panel>
      </Screen>
    );
  }
  if (!home) {
    return (
      <Screen>
        <Panel>
          <PanelLoading rows={6} />
        </Panel>
      </Screen>
    );
  }

  const g = home.glance;
  const pct = g && g.items ? Math.round((g.working / g.items) * 100) : null;

  return (
    <Screen>
      <div>
        <h1 className="text-17 font-semibold text-text m-0">
          {greeting()}, {home.name}
        </h1>
        <div className="text-11 text-faint mt-2">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      </div>

      <NextStepBanner step={home.nextStep} />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] gap-14 items-start">
        <div className="flex flex-col gap-14 min-w-0">
          <Panel title="Waiting for you">
            {home.waiting.length ? (
              home.waiting.map((w) => (
                <RowLink key={w.kind} href={w.path}>
                  <span className="flex-1 text-12">{w.label}</span>
                  <span className="text-11 font-semibold font-mono bg-accent text-white rounded-full px-7 leading-relaxed">{w.count}</span>
                </RowLink>
              ))
            ) : (
              <Quiet>Nothing is waiting for your decision.</Quiet>
            )}
          </Panel>

          {home.unfinished.length > 0 && (
            <Panel title="Unfinished">
              {home.unfinished.map((u) => (
                <RowLink key={u.path} href={u.path}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-12">{u.label}</span>
                    <span className="block text-11 text-dim mt-2">{u.detail}</span>
                  </span>
                </RowLink>
              ))}
            </Panel>
          )}

          <Panel title="Your requests">
            {home.mine.length ? (
              home.mine.map((r, i) => (
                <RowLink key={`${r.path}-${i}`} href={r.path}>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-6 flex-wrap">
                      <Tag>{r.kind}</Tag>
                      <span className="text-12 truncate">{r.label}</span>
                    </span>
                    <span className="block text-11 text-dim mt-3">
                      {r.status}
                      {r.detail ? ` · ${r.detail}` : ""}
                    </span>
                  </span>
                </RowLink>
              ))
            ) : (
              <Quiet>Nothing of yours is open. Transfers, purchase requests, bookings and changes you send show here until they are decided.</Quiet>
            )}
          </Panel>

          {home.dueSoon.length > 0 && (
            <Panel title="Due soon">
              {home.dueSoon.map((d) => (
                <RowLink key={`${d.itemId}-${d.what}`} href={d.path}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-12 truncate">{d.itemName}</span>
                    <span className="block text-11 text-dim mt-2">
                      {d.what}: {d.date}
                    </span>
                  </span>
                  <Tag tone={d.days < 0 ? "bad" : d.days <= 7 ? "warn" : "neutral"}>
                    {d.days < 0 ? `${-d.days} d overdue` : d.days === 0 ? "today" : `in ${d.days} d`}
                  </Tag>
                </RowLink>
              ))}
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-14 min-w-0">
          <Panel title="Recent updates">
            <RecentList items={home.recent} onOpen={(n) => void openNotice(n)} />
          </Panel>

          {g && (
            <Panel
              title={`At a glance · ${g.scopeName}`}
              actions={
                <Link href="/dashboard" className="text-11 text-accent">
                  Insights
                </Link>
              }
            >
              <div className="flex flex-wrap">
                <Stat label="Labs & stores" value={g.places.toLocaleString()} />
                <Stat label="Items" value={g.items.toLocaleString()} />
                <Stat label="Working" value={pct === null ? "—" : `${pct}%`} tone={pct !== null && pct >= 90 ? "good" : "warn"} />
                <Stat label="Need attention" value={g.attention.toLocaleString()} tone={g.attention ? "warn" : undefined} />
              </div>
            </Panel>
          )}

          {home.admin && (
            <Panel title="Loose ends">
              <RowLink href="/admin/org-structure">
                <span className="flex-1 text-12">Posts nobody holds</span>
                <span className="text-12 font-mono text-dim">{home.admin.vacantPosts}</span>
              </RowLink>
              <RowLink href="/places">
                <span className="flex-1 text-12">Labs & stores whose custodian can&apos;t run them</span>
                <span className="text-12 font-mono text-dim">{home.admin.placesWithoutCustodian}</span>
              </RowLink>
              <RowLink href="/admin/people">
                <span className="flex-1 text-12">People with no role</span>
                <span className="text-12 font-mono text-dim">{home.admin.peopleWithoutRole}</span>
              </RowLink>
              <RowLink href="/admin/people">
                <span className="flex-1 text-12">Invitations not yet accepted</span>
                <span className="text-12 font-mono text-dim">{home.admin.invitationsPending}</span>
              </RowLink>
            </Panel>
          )}
        </div>
      </div>
    </Screen>
  );
}
