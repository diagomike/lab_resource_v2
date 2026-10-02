"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PlaceDto, PlaceOptionsDto, ResourceCategoryDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Button, Panel, Screen, Tag } from "@/components/ui";
import { EmptyState, InlineError, PanelLoading } from "@/components/states";
import { CategoryIcon } from "@/components/resources/IconPicker";
import { AddPlaceModal } from "./PlaceForms";
import { couldNotLoad } from "@/components/toast";

/** "Block 510 · Room 8 · 25 seats" — the details people recognise a place by. */
export function placeSummary(p: Pick<PlaceDto, "props">): string {
  const v = (k: string) => (p.props[k] === null || p.props[k] === undefined || p.props[k] === "" ? null : String(p.props[k]));
  return [v("block") && `Block ${v("block")}`, v("room") && `Room ${v("room")}`, v("seats") && `${v("seats")} seats`, v("level")].filter(Boolean).join(" · ");
}

export function DraftTag({ status }: { status: PlaceDto["draftStatus"] }) {
  if (status === "SUBMITTED") return <Tag tone="warn">Changes waiting for the head</Tag>;
  if (status === "EDITING") return <Tag tone="accent">Changes not sent yet</Tag>;
  return null;
}

/**
 * Labs & stores — the places a person runs (custodians) or manages (heads, the ADAA,
 * Property Administration, the admin). Managers add places and assign who runs them;
 * everyone opens a place for what it holds and its changes.
 */
export default function PlacesPage() {
  const [places, setPlaces] = useState<PlaceDto[] | null>(null);
  const [options, setOptions] = useState<PlaceOptionsDto | null>(null);
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");

  function load() {
    setError(null);
    api
      .get<PlaceDto[]>("/places")
      .then(setPlaces)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the labs and stores"));
  }
  useEffect(() => {
    load();
    api.get<PlaceOptionsDto>("/places/options").then(setOptions).catch(() => setOptions({ kinds: [], units: [] }));
    api.get<ResourceCategoryDto[]>("/resources/categories").then(setCategories).catch(couldNotLoad("the categories", () => setCategories([])));
  }, []);

  const canAdd = Boolean(options?.units.length && options.kinds.length);
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (places ?? []).filter((p) => !needle || `${p.name} ${p.ownerOrgNodeName} ${p.custodianName} ${placeSummary(p)}`.toLowerCase().includes(needle));
  }, [places, filter]);
  const mine = shown.filter((p) => p.isMine);
  const managed = shown.filter((p) => !p.isMine);
  const byUnit = useMemo(() => {
    const m = new Map<string, PlaceDto[]>();
    for (const p of managed) m.set(p.ownerOrgNodeName, [...(m.get(p.ownerOrgNodeName) ?? []), p]);
    return [...m.entries()];
  }, [managed]);

  return (
    <Screen>
      <Panel
        title="Labs & stores"
        actions={
          canAdd ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              + Add a lab or store
            </Button>
          ) : undefined
        }
      >
        {error ? (
          <InlineError message={error} onRetry={load} />
        ) : places === null ? (
          <PanelLoading rows={5} />
        ) : places.length === 0 ? (
          canAdd ? (
            <EmptyState title="No labs or stores yet" body="Add the first one, and choose the custodian who runs it. They are told, and they record what it holds." action={{ label: "Add a lab or store", onClick: () => setAdding(true) }} />
          ) : (
            <EmptyState title="You don't run a lab yet" body="Your department head assigns you to a lab or store. It appears here, with what it holds and your changes." />
          )
        ) : (
          <div className="flex flex-col">
            {places.length > 6 && (
              <div className="px-14 py-9 border-b border-border">
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a lab, room or custodian…" aria-label="Find a lab, room or custodian" className="h-28 w-full max-w-[360px] px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent" />
              </div>
            )}
            {mine.length > 0 && <PlaceGroup title="You run" places={mine} />}
            {byUnit.map(([unit, rows]) => (
              <PlaceGroup key={unit} title={unit} places={rows} />
            ))}
            {shown.length === 0 && <div className="px-14 py-12 text-11.5 text-dim">Nothing matches “{filter}”.</div>}
          </div>
        )}
      </Panel>
      {adding && options && <AddPlaceModal options={options} categories={categories} onClose={() => setAdding(false)} />}
    </Screen>
  );
}

function PlaceGroup({ title, places }: { title: string; places: PlaceDto[] }) {
  return (
    <section className="border-b border-border last:border-0">
      <h3 className="px-14 pt-10 pb-4 text-11 uppercase tracking-label text-dim font-semibold">
        {title} <span className="font-mono normal-case">({places.length})</span>
      </h3>
      <ul>
        {places.map((p) => (
          <li key={p.id}>
            <Link href={`/places/${p.id}`} className="px-14 py-9 flex flex-wrap items-center gap-x-10 gap-y-4 hover:bg-panel2 text-text hover:no-underline">
              <CategoryIcon iconKey={p.categoryIconKey} className="size-16 text-dim flex-none" />
              <span className="flex flex-col min-w-[200px] flex-1">
                <span className="text-12 font-medium">{p.name}</span>
                <span className="text-11 text-dim">
                  {[p.categoryName, placeSummary(p), p.isMine ? null : `run by ${p.custodianName}`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-11 text-dim font-mono whitespace-nowrap">
                {p.itemCount.toLocaleString()} thing{p.itemCount === 1 ? "" : "s"}
              </span>
              {p.needsAttention > 0 && <Tag tone="bad">{p.needsAttention} need attention</Tag>}
              <DraftTag status={p.draftStatus} />
              {p.bookable && <Tag>Bookable</Tag>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
