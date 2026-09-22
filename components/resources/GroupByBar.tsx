"use client";

import { X } from "lucide-react";
import { GROUP_BY_OPTIONS, type GroupByKey } from "@/lib/register/useRegisterState";

/**
 * The grouped view's "Group by" chooser — up to three stacked levels ("Owning unit,
 * then Category"). Each resource keeps its own nested contents under the last level.
 */
export function GroupByBar({ value, onChange }: { value: GroupByKey[]; onChange: (next: GroupByKey[]) => void }) {
  const unused = GROUP_BY_OPTIONS.filter((o) => !value.includes(o.key));
  const labelOf = (k: GroupByKey) => GROUP_BY_OPTIONS.find((o) => o.key === k)?.label ?? k;
  const selectCls = "h-24 px-6 rounded-2 border border-border2 bg-panel text-10.5 outline-none focus:border-accent";

  return (
    <div className="flex flex-wrap items-center gap-6 px-14 py-7 border-b border-border text-10.5">
      <span className="text-9.5 uppercase tracking-label text-faint font-semibold">Group by</span>
      {value.map((k, i) => (
        <span key={k} className="flex items-center gap-4">
          {i > 0 && <span className="text-faint">then</span>}
          <select
            value={k}
            onChange={(e) => onChange(value.map((v, j) => (j === i ? (e.target.value as GroupByKey) : v)))}
            className={selectCls}
          >
            <option value={k}>{labelOf(k)}</option>
            {unused.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Stop grouping by ${labelOf(k)}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="grid size-18 place-items-center rounded-2 text-faint hover:bg-panel2 hover:text-text"
          >
            <X className="size-11" />
          </button>
        </span>
      ))}
      {value.length < 3 && unused.length > 0 && (
        <select value="" onChange={(e) => e.target.value && onChange([...value, e.target.value as GroupByKey])} className={selectCls}>
          <option value="">{value.length ? "+ then by…" : "Choose a grouping…"}</option>
          {unused.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
