"use client";

import { useEffect, useState } from "react";
import type { ContainerOptionDto, ItemDetailDto, PersonSummaryDto } from "@/lib/shared";
import { TreePicker, containerTreeOptions, type TreeOption } from "@/components/TreePicker";
import { itemStatuses } from "@/lib/shared";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { useEditOptions } from "@/lib/register/useEditOptions";
import { Modal, Button, ErrorNote } from "@/components/ui";

type ChangeKind = "setStatus" | "setCustodian" | "setOwnerOrg" | "setCurrentOrg" | "moveInTree" | "deleteItem";

const KINDS: Array<{ kind: ChangeKind; label: string; blurb: string }> = [
  { kind: "setStatus", label: "Status", blurb: "Report this as broken, under maintenance, lost or back in service." },
  { kind: "setCustodian", label: "Custody", blurb: "Hand day-to-day responsibility to another member of staff." },
  {
    kind: "setOwnerOrg",
    label: "Ownership",
    blurb: "Permanently transfer the resource to another unit. For a temporary loan, change the current unit instead.",
  },
  {
    kind: "setCurrentOrg",
    label: "Current unit",
    blurb: "Record which unit is holding the resource right now, without changing who owns it. This is the borrowing case.",
  },
  {
    kind: "moveInTree",
    label: "Position",
    blurb: "Move it somewhere else in the tree. Owning unit and custodian stay as they are — position and accountability are separate facts.",
  },
  { kind: "deleteItem", label: "Delete", blurb: "Remove this resource and everything physically nested inside it." },
];

function currentValueFor(kind: ChangeKind, item: ItemDetailDto): string {
  if (kind === "setStatus") return item.status;
  if (kind === "setCustodian") return item.custodianId;
  if (kind === "setOwnerOrg") return item.ownerOrgNodeId;
  if (kind === "setCurrentOrg") return item.currentOrgNodeId;
  if (kind === "moveInTree") return item.parentId ?? "";
  return "";
}

function currentLabelFor(kind: ChangeKind, item: ItemDetailDto): string {
  if (kind === "setStatus") return STATUS_LABEL[item.status];
  if (kind === "setCustodian") return item.custodianName;
  if (kind === "setOwnerOrg") return item.ownerOrgNodeName;
  if (kind === "setCurrentOrg") return item.currentOrgNodeName;
  if (kind === "moveInTree") return item.path.length ? item.path[item.path.length - 1] : "Top level";
  return item.name;
}

/**
 * The consequential-change gateway — clicking a row's "Change this…" opens this
 * instead of the scattered per-field selects Inspector used to carry. One kind at a
 * time, deliberately: Status / Custody / Ownership / Current unit / Position /
 * Delete, each its own tab with a clear current→new. Corrections (name, quantity,
 * category-defined properties) stay instant-inline in Inspector itself — matching
 * this app's own `CONFIRMED_CHANGES` rule and temp_works' identical split ("the
 * changes worth stopping for" vs. corrections typed inline).
 *
 * Transfer is deliberately NOT a tab here — it already has its own dedicated flow
 * (`TransferModal`, Track 3), reached in and out of another unit's custody, with a
 * real approval chain behind it. This modal's own kinds apply directly, the same as
 * every other write in this app today; no policy/route preview is shown because
 * none of these kinds are policy-gated (only transferItem is).
 */
export function ChangeModal({
  item,
  onClose,
  onDone,
  initialKind = "setStatus",
}: {
  item: ItemDetailDto;
  onClose: () => void;
  onDone: () => void;
  initialKind?: ChangeKind;
}) {
  const [kind, setKind] = useState<ChangeKind>(initialKind);
  const [value, setValue] = useState(() => currentValueFor(initialKind, item));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moveTargets, setMoveTargets] = useState<ContainerOptionDto[]>([]);
  const [people, setPeople] = useState<PersonSummaryDto[]>([]);
  const options = useEditOptions();

  // Custody can go to anyone eligible, not only people who already custody something
  // in the loaded register — the forest-derived list alone could never offer a newly
  // appointed store keeper or custodian.
  useEffect(() => {
    if (kind !== "setCustodian") return;
    let cancelled = false;
    api
      .get<PersonSummaryDto[]>("/people/custodians")
      .then((rows) => !cancelled && setPeople(rows))
      .catch(() => !cancelled && setPeople([]));
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const custodianOptions = (() => {
    const byId = new Map(options.custodian.map((o) => [o.value, o.label]));
    for (const p of people) byId.set(p.id, p.homeNodeName ? `${p.name} — ${p.homeNodeName}` : p.name);
    return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  })();

  useEffect(() => {
    setValue(currentValueFor(kind, item));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    if (kind !== "moveInTree") return;
    let cancelled = false;
    api
      .get<ContainerOptionDto[]>(`/resources/items/containers?categoryId=${encodeURIComponent(item.categoryId)}&exclude=${encodeURIComponent(item.id)}`)
      .then((rows) => !cancelled && setMoveTargets(rows))
      .catch(() => !cancelled && setMoveTargets([]));
    return () => {
      cancelled = true;
    };
  }, [kind, item.categoryId, item.id]);

  const active = KINDS.find((k) => k.kind === kind)!;
  const expectedVersions = { [item.id]: item.version };

  const selectOptions: Array<{ value: string; label: string }> =
    kind === "setStatus"
      ? itemStatuses.map((s) => ({ value: s, label: STATUS_LABEL[s] }))
      : kind === "setCustodian"
        ? custodianOptions
        : kind === "setOwnerOrg"
          ? options.owner
          : kind === "setCurrentOrg"
            ? options.currentOrg
            : kind === "moveInTree"
              ? moveTargets.map((c) => ({ value: c.id, label: c.name }))
              : [];
  // Places and units are hierarchies — pick them from a tree, not a flat list.
  const treeOptions: TreeOption[] | null =
    kind === "moveInTree"
      ? containerTreeOptions(moveTargets)
      : kind === "setOwnerOrg"
        ? options.unitTree(options.owner)
        : kind === "setCurrentOrg"
          ? options.unitTree(options.currentOrg)
          : null;

  const currentLabel = currentLabelFor(kind, item);
  const newLabel = kind === "deleteItem" ? "Delete this resource and its contents" : (selectOptions.find((o) => o.value === value)?.label ?? "—");
  const unchanged = kind !== "deleteItem" && value === currentValueFor(kind, item);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const input =
        kind === "deleteItem"
          ? { kind: "deleteItem" as const, itemIds: [item.id], note: note.trim() || undefined, expectedVersions }
          : kind === "moveInTree"
            ? { kind: "moveInTree" as const, itemIds: [item.id], value: value || null, note: note.trim() || undefined, expectedVersions }
            : { kind, itemIds: [item.id], value, note: note.trim() || undefined, expectedVersions };
      await api.post("/resources/items/changes", input);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply this change");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Change "${item.name}"`} onClose={onClose} width="520px">
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            onClick={() => setKind(k.kind)}
            style={{ background: kind === k.kind ? "var(--accent)" : "var(--panel2)", color: kind === k.kind ? "#fff" : "var(--dim)" }}
            className="border-0 text-10.5 font-medium px-6 py-6 rounded-2"
          >
            {k.label}
          </button>
        ))}
      </div>

      <p className="text-10.5 text-faint leading-relaxed">{active.blurb}</p>

      <div className="flex items-center gap-10 rounded-2 border border-border2 bg-panel2 px-10 py-8">
        <div className="min-w-0 flex-1">
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold">Current</div>
          <div className="text-11 font-medium truncate">{currentLabel}</div>
        </div>
        <span className="text-faint">→</span>
        <div className="min-w-0 flex-1">
          <div className="text-9.5 uppercase tracking-label text-faint font-semibold">New</div>
          <div className={`text-11 font-medium truncate ${kind !== "deleteItem" && !value ? "text-faint" : ""}`}>{kind === "deleteItem" || value ? newLabel : "not chosen yet"}</div>
        </div>
      </div>

      <label className="flex flex-col gap-4">
        <span className="text-10.5 font-medium">New {active.label.toLowerCase()}</span>
        {kind === "deleteItem" ? (
          <div className="rounded-2 border border-bad bg-badbg px-10 py-8 text-10.5 text-bad">This removes every descendant of this resource as well. It cannot be undone.</div>
        ) : treeOptions ? (
          <TreePicker options={treeOptions} value={value} onChange={setValue} placeholder="Select…" />
        ) : (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent">
            <option value="">Select…</option>
            {selectOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="flex flex-col gap-4">
        <span className="text-10.5 font-medium">
          Reason <span className="text-faint">(optional)</span>
        </span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. moved for the networking course, semester 2"
          className="h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
        />
      </label>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-8">
        <Button variant={kind === "deleteItem" ? "danger" : "primary"} onClick={submit} disabled={busy || unchanged || (kind !== "deleteItem" && !value)}>
          {busy ? "Working…" : kind === "deleteItem" ? "Delete" : "Confirm & apply"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
