"use client";

import { useState } from "react";
import type { CategoryGroupDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Modal, Button, ErrorNote } from "@/components/ui";

/**
 * The managed group vocabulary — ported behaviorally from
 * temp_works/src/app/categories/page.tsx's `GroupManager`: renaming preserves every
 * category's membership through the group's own id (a name-column update, nothing
 * else moves); deleting is offered only while a group is empty, refused server-side
 * otherwise (category-groups.ts's own `remove()`).
 */
export function CategoryGroupManager({
  groups,
  usage,
  onClose,
  onChanged,
}: {
  groups: CategoryGroupDto[];
  /** categoryId count per groupId — drives the delete guard shown here (the server is
   *  the real guard; this is just so the button reads "cannot delete" before a click
   *  round-trips to find that out). */
  usage: Map<string, number>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [next, setNext] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addGroup() {
    const name = next.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/resources/category-groups", { name });
      setNext("");
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add this group");
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(id: string) {
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/resources/category-groups/${id}`, { name });
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not rename this group");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/resources/category-groups/${id}`);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete this group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Category groups" onClose={onClose} width="480px">
      <p className="text-10.5 text-dim">The shelves categories are filed under, shared by every picker in the app.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex flex-col gap-6">
        {groups.map((g) => {
          const used = usage.get(g.id) ?? 0;
          const isEditing = editing === g.id;
          return (
            <div key={g.id} className="flex items-center gap-8 border border-border2 rounded-2 px-8 py-6">
              {isEditing ? (
                <>
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveRename(g.id);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="flex-1 h-22 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
                  />
                  <Button variant="primary" onClick={() => saveRename(g.id)} disabled={busy}>
                    Save
                  </Button>
                  <Button onClick={() => setEditing(null)} disabled={busy}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-11.5 font-medium">{g.name}</span>
                  <span className="text-10 text-faint font-mono">
                    {used} categor{used === 1 ? "y" : "ies"}
                  </span>
                  <Button
                    onClick={() => {
                      setEditing(g.id);
                      setDraftName(g.name);
                    }}
                    disabled={busy}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || used > 0}
                    onClick={() => deleteGroup(g.id)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-8">
        <input
          placeholder="New group name…"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addGroup()}
          className="flex-1 h-24 px-8 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
        />
        <Button variant="primary" disabled={!next.trim() || busy} onClick={addGroup}>
          Add group
        </Button>
      </div>
      <p className="text-10 text-faint">Renaming a group moves every category filed under it. A group can only be deleted once it is empty.</p>
    </Modal>
  );
}
