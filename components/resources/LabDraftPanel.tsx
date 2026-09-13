"use client";

import { useEffect, useMemo, useState } from "react";
import type { IdealVsActualRowDto, ItemChangeInput, ItemDraftChangeDto, ItemRowDto, ResourceCategoryDto } from "@/lib/shared";
import { itemStatuses } from "@/lib/shared";
import { CHANGE_LABEL } from "@/lib/domain/types";
import { STATUS_LABEL } from "@/lib/domain/status";
import { api, ApiError } from "@/lib/api";
import { Modal, Panel, Button, ErrorNote, Tag } from "@/components/ui";

type StageableKind = "createItem" | "setName" | "setStatus" | "setQuantity" | "deleteItem";

const STAGEABLE_KINDS: StageableKind[] = ["createItem", "setName", "setStatus", "setQuantity", "deleteItem"];

function describeChange(row: ItemDraftChangeDto, itemName: (id: string) => string, categoryName: (id: string) => string): string {
  if (row.targetKind === "IDEAL") {
    const p = row.payload as { categoryId: string; qty: number };
    return `Ideal target: ${p.qty} × ${categoryName(p.categoryId)}`;
  }
  const p = row.payload as ItemChangeInput;
  const label = CHANGE_LABEL[p.kind] ?? p.kind;
  if (p.kind === "createItem") {
    const what = p.name ? `"${p.name}" (${categoryName(p.categoryId)})` : categoryName(p.categoryId);
    return `${label}: ${p.count} × ${what} inside ${p.parentId ? itemName(p.parentId) : "—"}`;
  }
  const ids = "itemIds" in p ? p.itemIds : [];
  const names = ids.map(itemName).join(", ");
  if (p.kind === "setName") return `${label}: ${names} → "${p.value}"`;
  if (p.kind === "setStatus") return `${label}: ${names} → ${STATUS_LABEL[p.value as keyof typeof STATUS_LABEL] ?? p.value}`;
  if (p.kind === "setQuantity") return `${label}: ${names} → ${p.value}`;
  if (p.kind === "deleteItem") return `${label}: ${names}`;
  return `${label}: ${names}`;
}

/**
 * Track 2's staging area for one lab — full CRUD-in-draft over the lab's own
 * subtree, with no approval needed to stage; submitting groups everything into one
 * commit for the department head to decide. Deliberately supports the four most
 * common operations (add resources, rename, status, quantity, delete) rather than
 * every ItemChangeKind the server already accepts — moveInTree/images/custom
 * properties are a natural follow-up, not a capability gap in `stageChange` itself.
 */
export function LabDraftPanel({ labItemId, labName, onClose }: { labItemId: string; labName: string; onClose: () => void }) {
  const [rows, setRows] = useState<ItemRowDto[]>([]);
  const [draft, setDraft] = useState<ItemDraftChangeDto[] | null>(null);
  const [idealVsActual, setIdealVsActual] = useState<IdealVsActualRowDto[] | null>(null);
  const [categories, setCategories] = useState<ResourceCategoryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<StageableKind>("setStatus");
  const [targetId, setTargetId] = useState("");
  const [value, setValue] = useState("");
  const [createCategoryId, setCreateCategoryId] = useState("");
  const [createCount, setCreateCount] = useState("1");

  const [idealCategoryId, setIdealCategoryId] = useState("");
  const [idealQty, setIdealQty] = useState("");

  function load() {
    setError(null);
    Promise.all([
      api.get<{ items: ItemRowDto[] }>("/resources/items/tree"),
      api.get<ItemDraftChangeDto[]>(`/resources/labs/${labItemId}/draft`),
      api.get<IdealVsActualRowDto[]>(`/resources/labs/${labItemId}/ideal-vs-actual`),
      api.get<ResourceCategoryDto[]>("/resources/categories"),
    ])
      .then(([tree, d, ideal, cats]) => {
        const byId = new Map(tree.items.map((r) => [r.id, r]));
        const inLab = tree.items.filter((r) => {
          let cur: ItemRowDto | undefined = r;
          while (cur) {
            if (cur.id === labItemId) return true;
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
          }
          return false;
        });
        setRows(inLab);
        setDraft(d);
        setIdealVsActual(ideal);
        setCategories(cats);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load this lab's draft"));
  }

  useEffect(load, [labItemId]);

  const itemName = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    byId.set(labItemId, labName);
    return (id: string) => byId.get(id) ?? id;
  }, [rows, labItemId, labName]);

  const categoryName = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => byId.get(id) ?? id;
  }, [categories]);

  const canStage = kind === "createItem" ? Boolean(targetId && createCategoryId && Number(createCount) >= 1) : Boolean(targetId);

  async function stage() {
    if (!canStage) return;
    setBusy(true);
    setError(null);
    try {
      let change: ItemChangeInput;
      if (kind === "createItem") {
        change = { kind: "createItem", parentId: targetId, categoryId: createCategoryId, count: Number(createCount), ...(value.trim() ? { name: value.trim() } : {}) };
      } else if (kind === "setName") change = { kind: "setName", itemIds: [targetId], value };
      else if (kind === "setStatus") change = { kind: "setStatus", itemIds: [targetId], value: value as (typeof itemStatuses)[number] };
      else if (kind === "setQuantity") change = { kind: "setQuantity", itemIds: [targetId], value: Number(value) };
      else change = { kind: "deleteItem", itemIds: [targetId] };
      await api.post(`/resources/labs/${labItemId}/draft`, { targetKind: "VISIBLE", change });
      setValue("");
      setCreateCount("1");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not stage this change");
    } finally {
      setBusy(false);
    }
  }

  async function stageIdeal() {
    if (!idealCategoryId || !idealQty) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/resources/labs/${labItemId}/draft`, { targetKind: "IDEAL", categoryId: idealCategoryId, qty: Number(idealQty) });
      setIdealQty("");
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not stage this ideal target");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: string) {
    setBusy(true);
    try {
      await api.delete(`/resources/draft-changes/${id}`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not withdraw this staged change");
    } finally {
      setBusy(false);
    }
  }

  async function submit(targetKind: "VISIBLE" | "IDEAL") {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ status: string }>(`/resources/labs/${labItemId}/draft/submit`, { targetKind });
      load();
      return result;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not submit for approval");
    } finally {
      setBusy(false);
    }
  }

  const openVisible = (draft ?? []).filter((d) => d.targetKind === "VISIBLE");
  const openIdeal = (draft ?? []).filter((d) => d.targetKind === "IDEAL");

  return (
    <Modal title={`Draft — ${labName}`} onClose={onClose} width="720px">
      {error && <ErrorNote>{error}</ErrorNote>}

      <Panel title="Stage a change">
        <div className="p-12 flex flex-wrap items-end gap-8">
          <label className="flex flex-col gap-3">
            <span className="text-9.5 uppercase tracking-label text-faint">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as StageableKind)} className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5">
              {STAGEABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CHANGE_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-3">
            <span className="text-9.5 uppercase tracking-label text-faint">{kind === "createItem" ? "Inside" : "Item"}</span>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 min-w-[180px]">
              <option value="">Choose…</option>
              <option value={labItemId}>{labName} (the lab itself)</option>
              {rows.filter((r) => r.id !== labItemId).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          {kind === "createItem" && (
            <>
              <label className="flex flex-col gap-3">
                <span className="text-9.5 uppercase tracking-label text-faint">Category</span>
                <select value={createCategoryId} onChange={(e) => setCreateCategoryId(e.target.value)} className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 min-w-[150px]">
                  <option value="">Choose…</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-3">
                <span className="text-9.5 uppercase tracking-label text-faint">Count</span>
                <input value={createCount} onChange={(e) => setCreateCount(e.target.value)} type="number" min="1" className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 w-[70px]" />
              </label>
            </>
          )}
          {kind !== "deleteItem" && (
            <label className="flex flex-col gap-3">
              <span className="text-9.5 uppercase tracking-label text-faint">{kind === "createItem" ? "Name (optional)" : "Value"}</span>
              {kind === "setStatus" ? (
                <select value={value} onChange={(e) => setValue(e.target.value)} className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5">
                  <option value="">Choose…</option>
                  {itemStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  type={kind === "setQuantity" ? "number" : "text"}
                  className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5"
                />
              )}
            </label>
          )}
          <Button variant="primary" onClick={stage} disabled={busy || !canStage}>
            Stage
          </Button>
        </div>
      </Panel>

      <Panel title={`Staged changes (${openVisible.length})`} actions={openVisible.length > 0 ? <Button variant="primary" onClick={() => submit("VISIBLE")} disabled={busy}>Submit for approval</Button> : undefined}>
        {openVisible.length === 0 ? (
          <div className="px-14 py-12 text-11 text-dim">Nothing staged yet.</div>
        ) : (
          <div className="flex flex-col">
            {openVisible.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-14 py-8 border-b border-border last:border-0 text-11">
                <span>{describeChange(d, itemName, categoryName)}</span>
                <button className="text-10.5 text-bad" onClick={() => withdraw(d.id)}>
                  Withdraw
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Ideal state">
        <div className="p-12 flex flex-wrap items-end gap-8 border-b border-border">
          <label className="flex flex-col gap-3">
            <span className="text-9.5 uppercase tracking-label text-faint">Category</span>
            <select value={idealCategoryId} onChange={(e) => setIdealCategoryId(e.target.value)} className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 min-w-[160px]">
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-3">
            <span className="text-9.5 uppercase tracking-label text-faint">Target quantity</span>
            <input value={idealQty} onChange={(e) => setIdealQty(e.target.value)} type="number" className="h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 w-[100px]" />
          </label>
          <Button onClick={stageIdeal} disabled={busy || !idealCategoryId || !idealQty}>
            Stage ideal target
          </Button>
          {openIdeal.length > 0 && (
            <Button variant="primary" onClick={() => submit("IDEAL")} disabled={busy}>
              Submit ideal ({openIdeal.length})
            </Button>
          )}
        </div>

        {idealVsActual === null ? null : idealVsActual.length === 0 ? (
          <div className="px-14 py-12 text-11 text-dim">No ideal targets set yet.</div>
        ) : (
          <table className="w-full text-11">
            <thead>
              <tr className="text-9.5 uppercase tracking-label text-faint border-b border-border">
                <th className="text-left px-14 py-7">Category</th>
                <th className="text-right px-14 py-7">Ideal</th>
                <th className="text-right px-14 py-7">Actual</th>
                <th className="text-right px-14 py-7">Gap</th>
                <th className="text-left px-14 py-7">Needs attention</th>
              </tr>
            </thead>
            <tbody>
              {idealVsActual.map((r) => (
                <tr key={r.categoryId} className="border-b border-border last:border-0">
                  <td className="px-14 py-7">{r.categoryName}</td>
                  <td className="px-14 py-7 text-right font-mono">{r.idealQty}</td>
                  <td className="px-14 py-7 text-right font-mono">{r.actualCount}</td>
                  <td className={`px-14 py-7 text-right font-mono ${r.gap > 0 ? "text-warn" : ""}`}>{r.gap}</td>
                  <td className="px-14 py-7">
                    {r.brokenItems.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <Tag tone="bad">{r.brokenItems.length} broken</Tag>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Modal>
  );
}
