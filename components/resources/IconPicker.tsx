"use client";

import { CATEGORY_ICON_OPTIONS, categoryIconFor } from "@/lib/domain/icons";

/** Renders one category's icon — the thin UI wrapper `lib/domain/icons.ts`'s own
 *  header comment says belongs in components/**, not lib/domain/**. Every place a
 *  category icon renders (the Studio's sidebar rows, the editor, AddModal's category
 *  picker later) should use this rather than reaching into `categoryIconFor` directly,
 *  so sizing/fallback stay in one place. */
export function CategoryIcon({ iconKey, className = "size-4" }: { iconKey?: string; className?: string }) {
  const Icon = categoryIconFor(iconKey);
  return <Icon className={className} />;
}

/**
 * A picker over the curated registry — never a free-text field, so `iconKey` can
 * never point outside `CATEGORY_ICONS`. No second icon vocabulary: this is the only
 * place a category's icon is chosen, and it renders straight from
 * `CATEGORY_ICON_OPTIONS`.
 */
export function IconPicker({ value, onChange }: { value: string; onChange: (iconKey: string) => void }) {
  return (
    <div className="flex items-center gap-6">
      <span className="w-24 h-24 flex items-center justify-center rounded-2 border border-border2 bg-panel2 flex-none">
        <CategoryIcon iconKey={value} className="size-14" />
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 h-24 px-6 rounded-2 border border-border2 bg-panel text-11 outline-none focus:border-accent"
      >
        {CATEGORY_ICON_OPTIONS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </div>
  );
}
