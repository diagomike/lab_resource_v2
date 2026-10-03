"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell as BellIcon } from "lucide-react";
import type { NotificationDto, NotificationsDto } from "@/lib/shared";
import { api } from "@/lib/api";
import { useHomeCounts } from "@/lib/home-counts";

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * The bell: how many notices are unread, and the latest ones, each opening its exact
 * item. The panel is fixed-positioned because the top bar clips its overflow.
 */
export default function Bell() {
  const router = useRouter();
  const { counts, refresh } = useHomeCounts();
  const unread = counts?.unread ?? 0;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function load() {
    setFailed(false);
    api.get<NotificationsDto>("/notifications?limit=15").then(
      (r) => setItems(r.items),
      () => setFailed(true),
    );
  }

  useEffect(() => {
    if (!open) return;
    load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function openItem(n: NotificationDto) {
    setOpen(false);
    if (!n.read) await api.post("/notifications/read", { ids: [n.id] }).catch(() => {});
    refresh();
    router.push(n.path);
  }

  async function markAll() {
    await api.post("/notifications/read", { all: true }).catch(() => {});
    setItems((list) => list?.map((n) => ({ ...n, read: true })) ?? null);
    refresh();
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Updates: ${unread} unread` : "Updates"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Updates"
        className={`relative border border-topline2 h-26 md:h-24 px-8 md:px-9 rounded-3 text-11 flex items-center gap-5 flex-none ${open ? "bg-topsel text-top" : "bg-topfill2 text-current"}`}
      >
        <BellIcon size={13} aria-hidden="true" />
        {unread > 0 && <span className="text-10.5 font-semibold font-mono bg-bad text-white rounded-full px-5 leading-relaxed">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Updates"
          className="fixed right-8 top-38 z-50 w-[min(380px,calc(100vw-16px))] max-h-[min(520px,calc(100vh-70px))] flex flex-col bg-panel text-text border border-border2 rounded-4"
        >
          <div className="flex items-center gap-8 px-12 py-8 border-b border-border flex-none">
            <div className="text-12 font-semibold flex-1">Updates</div>
            {unread > 0 && (
              <button onClick={() => void markAll()} className="border-0 bg-transparent text-11 text-accent cursor-pointer">
                Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto">
            {failed ? (
              <div className="px-12 py-12 text-11.5 text-dim">
                Couldn&apos;t load your updates.{" "}
                <button onClick={load} className="border-0 bg-transparent text-accent cursor-pointer text-11.5 p-0">
                  Try again
                </button>
              </div>
            ) : items === null ? (
              <div className="px-12 py-12 text-11.5 text-faint">Loading…</div>
            ) : items.length === 0 ? (
              <div className="px-12 py-14 text-11.5 text-dim leading-loose">Nothing yet. When something needs you, or something you asked for moves, it shows here.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => void openItem(n)}
                  className={`w-full text-left border-0 border-b border-border px-12 py-8 flex gap-8 cursor-pointer hover:bg-panel3 ${n.read ? "bg-transparent" : "bg-soft"}`}
                >
                  <span className={`w-6 h-6 rounded-full mt-5 flex-none ${n.read ? "bg-transparent" : n.declined ? "bg-bad" : "bg-accent"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-11.5 leading-snug ${n.read ? "text-dim" : "text-text font-medium"}`}>
                      {n.declined && <span className="mr-5 rounded-2 bg-badbg px-4 py-1 text-10.5 font-medium text-bad">Declined</span>}
                      {n.title}
                    </span>
                    {n.body && <span className="block text-11 text-dim leading-normal mt-2 line-clamp-2">{n.body}</span>}
                    <span className="block text-11 text-faint mt-3">
                      {n.actorName ? `${n.actorName} · ` : ""}
                      {timeAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="border-t border-border px-12 py-7 flex-none">
            <button
              onClick={() => {
                setOpen(false);
                router.push("/home");
              }}
              className="border-0 bg-transparent text-11 text-accent cursor-pointer p-0"
            >
              Open Home
            </button>
          </div>
        </div>
      )}
    </>
  );
}
