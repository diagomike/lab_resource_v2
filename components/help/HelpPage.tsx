"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { helpChaptersFor } from "@/lib/help/audience";
import { Modal, ErrorNote } from "@/components/ui";
import { PanelLoading } from "@/components/states";

/**
 * Help & guides — the user guide (docs/user-guide), built by scripts/build-help.mjs into
 * public/help/content.json and fetched only when Help is opened, so it adds nothing to
 * the rest of the app. Everyone sees the general chapters; the role chapters follow who
 * the person is (lib/help/audience.ts). ?c=<chapter> picks the chapter and #<section>
 * scrolls to a heading, which is how the top bar's Help opens the section for the
 * screen you were on.
 */

interface HelpSection {
  id: string;
  title: string;
  text: string;
}
interface HelpChapter {
  id: string;
  title: string;
  group: "general" | "role";
  hint: string;
  html: string;
  sections: HelpSection[];
}

let cache: Promise<HelpChapter[]> | null = null;
function loadHelp(): Promise<HelpChapter[]> {
  cache ??= fetch("/help/content.json")
    .then((r) => {
      if (!r.ok) throw new Error(`Help couldn't be loaded (${r.status}).`);
      return r.json() as Promise<{ chapters: HelpChapter[] }>;
    })
    .then((d) => d.chapters)
    .catch((e) => {
      cache = null;
      throw e;
    });
  return cache;
}

export default function HelpPage() {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [chapters, setChapters] = useState<HelpChapter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  // The section to scroll to after a click — within one chapter only the #hash changes,
  // which the search params don't see.
  const [target, setTarget] = useState<{ id?: string; n: number }>({ n: 0 });

  useEffect(() => {
    loadHelp().then(setChapters, (e: Error) => setError(e.message));
  }, []);

  const visible = useMemo(() => (chapters ? helpChaptersFor(me, chapters.map((c) => c.id)) : new Set<string>()), [chapters, me]);
  const general = chapters?.filter((c) => c.group === "general" && visible.has(c.id)) ?? [];
  const mine = chapters?.filter((c) => c.group === "role" && visible.has(c.id)) ?? [];
  const requested = params.get("c");
  const current = chapters?.find((c) => c.id === requested && visible.has(c.id)) ?? general[0] ?? null;
  const notYours = Boolean(requested && chapters?.some((c) => c.id === requested) && !visible.has(requested));

  // Scroll to the section in the address (#head--5-…) once the chapter is on screen,
  // otherwise to the top of the chapter.
  useEffect(() => {
    if (!current) return;
    const id = target.id ?? decodeURIComponent(window.location.hash.replace(/^#/, ""));
    const el = id ? document.getElementById(id) : null;
    if (el) el.scrollIntoView({ block: "start" });
    else contentRef.current?.scrollIntoView({ block: "start" });
  }, [current, params, target]);

  const open = (chapterId: string, sectionId?: string) => {
    setQuery("");
    router.push(`/help?c=${chapterId}${sectionId ? `#${sectionId}` : ""}`, { scroll: false });
    setTarget((t) => ({ id: sectionId, n: t.n + 1 }));
  };

  // Links inside the guide stay in the app; screenshots open larger.
  function onContentClick(e: MouseEvent<HTMLDivElement>) {
    const el = e.target as HTMLElement;
    const zoomBtn = el.closest("button.zoom") as HTMLButtonElement | null;
    if (zoomBtn) {
      const img = zoomBtn.querySelector("img");
      setZoom({ src: zoomBtn.dataset.src ?? img?.src ?? "", alt: img?.alt ?? "" });
      return;
    }
    const a = el.closest("a") as HTMLAnchorElement | null;
    const href = a?.getAttribute("href");
    if (href?.startsWith("/help")) {
      e.preventDefault();
      const url = new URL(href, window.location.origin);
      open(url.searchParams.get("c") ?? "welcome", url.hash.replace(/^#/, "") || undefined);
    }
  }

  // Search the sections of the chapters this person can read.
  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!chapters || !words.length) return [];
    const out: Array<{ chapter: HelpChapter; section: HelpSection; snippet: string }> = [];
    for (const chapter of chapters) {
      if (!visible.has(chapter.id)) continue;
      for (const section of chapter.sections) {
        const hay = `${section.title} ${section.text}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        const at = section.text.toLowerCase().indexOf(words[0]);
        const start = Math.max(0, at - 60);
        out.push({ chapter, section, snippet: (start > 0 ? "…" : "") + section.text.slice(start, start + 170) + "…" });
      }
    }
    // The exact phrase first, then a match in the heading, then the rest in guide order.
    const phrase = words.join(" ");
    const rank = (r: (typeof out)[number]) => (`${r.section.title} ${r.section.text}`.toLowerCase().includes(phrase) ? 0 : 2) + (r.section.title.toLowerCase().includes(words[0]) ? 0 : 1);
    return out.map((r, i) => ({ r, i })).sort((x, y) => rank(x.r) - rank(y.r) || x.i - y.i).map((x) => x.r).slice(0, 40);
  }, [query, chapters, visible]);

  if (error) return <div className="p-14"><ErrorNote>{error}</ErrorNote></div>;
  if (!chapters || !current) return <div className="p-14"><PanelLoading /></div>;

  const toc = current.sections.filter((s) => !s.id.endsWith("--top"));

  return (
    <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] min-h-full">
      <aside className="border-b md:border-b-0 md:border-r border-border bg-panel2 p-12 flex flex-col gap-12 md:sticky md:top-0 md:self-start md:max-h-[calc(100vh-110px)] md:overflow-y-auto">
        <label className="flex flex-col gap-4">
          <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Search the guides</span>
          <input
            id="help-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. hand over, booking, send back"
            className="h-28 px-9 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
          />
        </label>

        {/* Phones: one picker instead of the lists. */}
        <label className="md:hidden flex flex-col gap-4">
          <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Guide</span>
          <select id="help-chapter" value={current.id} onChange={(e) => open(e.target.value)} className="h-28 px-6 rounded-2 border border-border2 bg-panel text-11.5">
            <optgroup label="General">
              {general.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </optgroup>
            <optgroup label="For your role">
              {mine.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </optgroup>
          </select>
        </label>

        <nav className="hidden md:flex flex-col gap-12" aria-label="Guides">
          <ChapterList label="General" chapters={general} current={current.id} onOpen={open} />
          <ChapterList label={mine.length > 6 ? "Every role" : "For your role"} chapters={mine} current={current.id} onOpen={open} />
        </nav>
      </aside>

      <main className="min-w-0 px-14 md:px-24 py-16 pb-44">
        {query.trim() ? (
          <section aria-live="polite">
            <h1 className="text-17 font-semibold mb-4">Search: “{query.trim()}”</h1>
            <p className="text-11 text-dim mb-12">{results.length ? `${results.length} section${results.length === 1 ? "" : "s"} in your guides` : "Nothing in your guides matches. Try fewer or other words."}</p>
            <ul className="flex flex-col gap-8 max-w-[760px]">
              {results.map((r) => (
                <li key={r.section.id}>
                  <button type="button" onClick={() => open(r.chapter.id, r.section.id.endsWith("--top") ? undefined : r.section.id)} className="w-full text-left border border-border rounded-2 bg-panel hover:border-accent px-12 py-9">
                    <span className="block text-9.5 uppercase tracking-label text-faint">{r.chapter.title}</span>
                    <span className="block text-12 font-medium text-text">{r.section.title}</span>
                    <span className="block text-10.5 text-dim mt-2">{r.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <article ref={contentRef} className="max-w-[860px] scroll-mt-16">
            {notYours && (
              <div className="mb-12 text-11 bg-warnbg text-warn border border-warn rounded-2 px-12 py-8">
                That guide is for another role. Here are the guides for yours.
              </div>
            )}
            <div className="text-9.5 uppercase tracking-label text-faint font-semibold">{current.group === "general" ? "General" : "For your role"}</div>
            <h1 className="text-21 font-semibold leading-tight mt-2">{current.title}</h1>
            <p className="text-11.5 text-dim mt-2">{current.hint}</p>
            {toc.length > 2 && (
              <nav className="mt-12 flex flex-wrap gap-6" aria-label="In this guide">
                {toc.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      open(current.id, s.id);
                    }}
                    className="text-10.5 px-8 py-2 rounded-full bg-panel2 border border-border text-dim hover:text-accent hover:border-accent no-underline"
                  >
                    {s.title}
                  </a>
                ))}
              </nav>
            )}
            <div className="help-prose mt-8" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: current.html }} />
          </article>
        )}
      </main>

      {zoom && (
        <Modal title={zoom.alt || "Screenshot"} onClose={() => setZoom(null)} width="min(1200px, 96vw)">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static guide screenshot at its own size */}
          <img src={zoom.src} alt={zoom.alt} className="w-full h-auto rounded-2 border border-border bg-white" />
        </Modal>
      )}
    </div>
  );
}

function ChapterList({ label, chapters, current, onOpen }: { label: string; chapters: HelpChapter[]; current: string; onOpen: (id: string) => void }) {
  if (!chapters.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-9.5 uppercase tracking-label text-faint font-semibold px-6 pb-2">{label}</div>
      {chapters.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpen(c.id)}
          aria-current={c.id === current ? "page" : undefined}
          className={`text-left rounded-2 px-8 py-6 border-0 ${c.id === current ? "bg-soft text-accent" : "bg-transparent text-text hover:bg-panel3"}`}
        >
          <span className="block text-11.5 font-medium">{c.title}</span>
          <span className="block text-9.5 text-faint leading-snug">{c.hint}</span>
        </button>
      ))}
    </div>
  );
}
