"use client";

import { useEffect, useState } from "react";
import type { ChainStepDto, RequestTransferResultDto, TransferDestinationDto, TransferNamingDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";

type Preview = { outcome: "APPLIED" | "ROUTED" | "DENIED"; reason: string; steps?: ChainStepDto[]; naming?: TransferNamingDto };
type Person = { id: string; name: string; title: string | null; departmentName: string };

/**
 * The main store handing stock over — the one transfer that is still PUSHED. Every
 * other transfer is pulled from the Register's whole-university view
 * (`PullTransferModal`), so this modal is offered to store keepers and SYS_ADMIN only.
 *
 * Two kinds of handover:
 *  - to a lab: the destination's own custodian becomes the custodian, and the
 *    receiving unit the owner;
 *  - to a person (a lecturer's laptop): it lands in their department's Staff holdings,
 *    in their custody, and they accept it themselves.
 * Either way the receiving head approves, then Property Administration, then the
 * custodian accepts. approvals.ts refuses the ownership move for anyone but a store
 * keeper or SYS_ADMIN, whatever this modal offers.
 */
export function TransferModal({
  itemIds,
  label,
  onClose,
  onDone,
}: {
  itemIds: string[];
  /** What is being transferred, for the title — an item name, or "3 resources". */
  label: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"lab" | "person">("lab");
  const [personQuery, setPersonQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<TransferDestinationDto[]>([]);
  const [selected, setSelected] = useState<TransferDestinationDto | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RequestTransferResultDto | null>(null);
  // R2-3: what the items are called once they arrive. `null` = not chosen yet (the
  // destination's own name for this kind is filled in from the preview); "" = keep
  // their store names.
  const [renameAs, setRenameAs] = useState<string | null>(null);
  const [debouncedRename, setDebouncedRename] = useState<string | null>(null);
  const idsParam = itemIds.join(",");

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<TransferDestinationDto[]>(`/resources/transfers/destinations?itemIds=${encodeURIComponent(idsParam)}&q=${encodeURIComponent(query)}`)
        .then((rows) => !cancelled && setOptions(rows))
        .catch(() => !cancelled && setOptions([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, idsParam]);

  useEffect(() => {
    if (mode !== "person" || person || personQuery.trim().length < 2) {
      setPeople([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<Person[]>(`/resources/transfers/recipients?q=${encodeURIComponent(personQuery)}`)
        .then((rows) => !cancelled && setPeople(rows))
        .catch(() => !cancelled && setPeople([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, person, personQuery]);

  useEffect(() => {
    if (mode !== "person") return;
    setPreview(null);
    setPreviewError(null);
    if (!person) return;
    let live = true;
    api
      .post<Preview>("/resources/transfers/preview", { input: personInput(person) })
      .then((p) => live && setPreview(p))
      .catch((e) => live && setPreviewError(e instanceof ApiError ? e.message : "Could not resolve this handover"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, person]);

  function personInput(p: Person) {
    return {
      kind: "transferItem" as const,
      itemIds,
      transfer: { targetParentId: "", targetOrgNodeId: "", targetCustodianId: null, transferOwnership: true, issueToUserId: p.id },
    };
  }

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRename(renameAs), 300);
    return () => clearTimeout(t);
  }, [renameAs]);

  useEffect(() => {
    if (mode !== "lab") return;
    if (!selected) {
      setPreview(null);
      setRenameAs(null);
      return;
    }
    let live = true;
    setPreviewError(null);
    api
      .post<Preview>("/resources/transfers/preview", { input: transferInput(selected, debouncedRename) })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        if (renameAs === null && p.naming?.suggested) setRenameAs(p.naming.suggested);
      })
      .catch((e) => live && setPreviewError(e instanceof ApiError ? e.message : "Could not resolve this transfer"));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected, debouncedRename]);

  function transferInput(destination: TransferDestinationDto, name: string | null = renameAs) {
    const rename = name?.trim();
    return {
      kind: "transferItem" as const,
      itemIds,
      transfer: {
        targetParentId: destination.id,
        targetOrgNodeId: destination.orgNodeId,
        targetCustodianId: destination.custodianId,
        transferOwnership: true,
        ...(rename ? { renameAs: rename } : {}),
      },
    };
  }

  async function submit() {
    const input = mode === "person" ? (person ? personInput(person) : null) : selected ? transferInput(selected) : null;
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<RequestTransferResultDto>("/resources/transfers", { input });
      setDone(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not request this transfer");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Hand over" onClose={onDone} width="440px">
        <div className="text-11.5 text-dim">
          {done.outcome === "APPLIED"
            ? "Applied — the register is already updated."
            : "Requested. It now waits for approval — see Approvals."}
        </div>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title={`Hand over ${label}`} onClose={onClose} width="460px">
      <div className="flex items-center gap-4">
        {(["lab", "person"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setPreview(null);
              setPreviewError(null);
            }}
            style={{ background: mode === m ? "var(--accent)" : "var(--panel2)", color: mode === m ? "#fff" : "var(--dim)" }}
            className="border-0 text-10.5 font-medium px-9 py-4 rounded-2"
          >
            {m === "lab" ? "To a lab" : "To a person"}
          </button>
        ))}
      </div>

      {mode === "person" && (
        <div className="flex flex-col gap-8">
          <label className="text-9.5 uppercase tracking-label text-faint font-semibold">Issue to</label>
          <input
            value={person ? `${person.name} — ${person.departmentName}` : personQuery}
            onChange={(e) => {
              setPersonQuery(e.target.value);
              setPerson(null);
            }}
            placeholder="Search a member of staff by name or email…"
            className="h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
          />
          {!person && people.length > 0 && (
            <div className="border border-border2 rounded-2 max-h-[180px] overflow-y-auto">
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPerson(p);
                    setPersonQuery("");
                  }}
                  className="w-full text-left px-8 py-6 text-11 hover:bg-panel2 border-b border-border last:border-0"
                >
                  <div>{p.name}</div>
                  <div className="text-9.5 text-faint">
                    {p.departmentName}
                    {p.title ? ` · ${p.title}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!person && personQuery.trim().length >= 2 && people.length === 0 && <div className="text-10.5 text-faint">No matching member of staff.</div>}
          <div className="text-10.5 text-dim">
            It goes into {person ? `${person.departmentName}'s` : "their department's"} Staff holdings, in {person ? `${person.name}'s` : "their"} custody, once the head and
            Property Administration approve and they accept it.
          </div>
          {person && (
            <div className="text-10.5 border border-border2 rounded-2 px-8 py-6">
              {previewError ? (
                <ErrorNote>{previewError}</ErrorNote>
              ) : !preview ? (
                <span className="text-faint">Checking…</span>
              ) : preview.outcome === "DENIED" ? (
                <span className="text-bad">{preview.reason}</span>
              ) : preview.outcome === "APPLIED" ? (
                <span className="text-dim">Applies immediately — no approval needed.</span>
              ) : (
                <span className="text-dim">
                  Needs approval: {preview.steps?.filter((s) => s.status !== "SKIPPED").map((s) => (s.approverName ? `${s.label} (${s.approverName})` : s.label)).join(" → ")}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {mode === "lab" && (
        <div className="flex flex-col gap-8">
          <label className="text-9.5 uppercase tracking-label text-faint font-semibold">Destination</label>
          <input
            value={selected ? selected.name : query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder="Search the lab to hand this over to…"
            className="h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
          />
          {!selected && options.length > 0 && (
            <div className="border border-border2 rounded-2 max-h-[180px] overflow-y-auto">
              {options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setSelected(o);
                    setQuery("");
                  }}
                  className="w-full text-left px-8 py-6 text-11 hover:bg-panel2 border-b border-border last:border-0"
                >
                  <div>{o.name}</div>
                  <div className="text-9.5 text-faint">
                    {o.orgNodeName}
                    {o.path.length > 0 ? ` · in ${o.path.join(" › ")}` : ""}
                    {o.custodianName ? ` · held by ${o.custodianName}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!selected && query.trim().length >= 2 && options.length === 0 && (
            <div className="text-10.5 text-faint">No matching destination found.</div>
          )}
        </div>
      )}

      {mode === "lab" && (
        <div className="text-10.5 text-dim">
          Custody and ownership move{selected ? ` to ${selected.custodianName} and ${selected.orgNodeName}` : " to the receiving lab"} once its head and Property
          Administration approve and its custodian accepts.
        </div>
      )}

      {mode === "lab" && selected && (
        <div className="text-10.5 border border-border2 rounded-2 px-8 py-6">
          {previewError ? (
            <ErrorNote>{previewError}</ErrorNote>
          ) : !preview ? (
            <span className="text-faint">Checking…</span>
          ) : preview.outcome === "DENIED" ? (
            <span className="text-bad">{preview.reason}</span>
          ) : preview.outcome === "APPLIED" ? (
            <span className="text-dim">Applies immediately — no approval needed.</span>
          ) : (
            <span className="text-dim">
              Needs approval: {preview.steps?.filter((s) => s.status !== "SKIPPED").map((s) => s.label).join(" → ")}
            </span>
          )}
        </div>
      )}

      {mode === "lab" && selected && preview?.naming && preview.outcome !== "DENIED" && (
        <div className="flex flex-col gap-6">
          <label className="text-9.5 uppercase tracking-label text-faint font-semibold">Name them there as</label>
          <input
            value={renameAs ?? ""}
            onChange={(e) => setRenameAs(e.target.value)}
            placeholder="Keep their store names"
            className="h-28 px-8 rounded-2 border border-border2 bg-panel text-11.5 outline-none focus:border-accent"
          />
          <div className="text-10.5 text-dim">
            {renameAs?.trim() && preview.naming.planned.length
              ? `Arrive as ${preview.naming.planned.length > 4 ? `${preview.naming.planned.slice(0, 2).join(", ")} … ${preview.naming.planned.at(-1)}` : preview.naming.planned.join(", ")} — the next free numbers there.`
              : "They keep the names they have in the store."}
            {preview.naming.suggested && renameAs !== preview.naming.suggested && (
              <button type="button" onClick={() => setRenameAs(preview.naming!.suggested)} className="ml-6 text-accent hover:underline">
                Use &quot;{preview.naming.suggested}&quot;
              </button>
            )}
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center gap-8">
        <Button variant="primary" onClick={submit} disabled={(mode === "lab" ? !selected : !person) || !preview || preview.outcome === "DENIED" || busy}>
          {busy ? "Working…" : "Request handover"}
        </Button>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
