"use client";

import { CONTROL_CLASS, Dropdown } from "./Dropdown";
import type { DataTableColumn } from "./types";

/**
 * Column visibility. Worth stating plainly, because this app has a real column that
 * depends on it: hiding a column here is PRESENTATION, not access control. AssetsPage's
 * cost column is omitted server-side for roles without `canSeeCost` — that is what keeps
 * the value out of reach; this dropdown only decides what a permitted viewer wants to look
 * at right now.
 */
export function ViewOptions<T>({
  columns,
  hidden,
  onChange,
}: {
  columns: DataTableColumn<T>[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  const hideable = columns.filter((c) => c.hideable !== false && c.header.trim() !== "");
  if (hideable.length === 0) return null;

  return (
    <Dropdown
      width="200px"
      align="right"
      trigger={() => (
        <span className={`${CONTROL_CLASS} h-22 px-8`}>
          <span>Columns{hidden.length > 0 ? ` · ${hidden.length} hidden` : ""}</span>
          <span className="opacity-60">▾</span>
        </span>
      )}
    >
      {() => (
        <>
          <div className="max-h-[260px] overflow-y-auto">
            {hideable.map((c) => {
              const visible = !hidden.includes(c.id);
              return (
                <label key={c.id} className="flex items-center gap-6 px-8 py-6 text-10.5 hover:bg-panel3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() =>
                      onChange(visible ? [...hidden, c.id] : hidden.filter((id) => id !== c.id))
                    }
                  />
                  <span className="flex-1 truncate">{c.header}</span>
                </label>
              );
            })}
          </div>
          {hidden.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full text-center border-t border-border py-5 text-10 text-accent hover:bg-panel2"
            >
              Show all
            </button>
          )}
        </>
      )}
    </Dropdown>
  );
}
