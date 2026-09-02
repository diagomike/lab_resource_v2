import { PAGE_SIZES } from "./config";
import { MiniSelect } from "./Dropdown";

/**
 * Page navigation plus a page-size control and an honest "showing X–Y of Z" readout. Both
 * the page and the size live in the URL, so a link to page 3 of a 50-row view opens on
 * page 3 of a 50-row view.
 */
export function Pagination({
  page,
  size,
  total,
  onPage,
  onSize,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pageCount);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, total);

  // Offer a size the caller opted into even when it is not one of the standard steps, so
  // selecting it does not silently snap the view to something else.
  const sizes = PAGE_SIZES.includes(size) ? PAGE_SIZES : [...PAGE_SIZES, size].sort((a, b) => a - b);

  return (
    <div className="px-14 py-8 border-t border-border flex items-center gap-8 flex-wrap">
      <button
        disabled={current <= 1}
        onClick={() => onPage(current - 1)}
        className="border border-border2 bg-panel2 h-22 px-8 rounded-2 text-10.5 disabled:opacity-40"
      >
        ← Prev
      </button>
      <span className="text-10.5 text-dim font-mono">
        {current} / {pageCount}
      </span>
      <button
        disabled={current >= pageCount}
        onClick={() => onPage(current + 1)}
        className="border border-border2 bg-panel2 h-22 px-8 rounded-2 text-10.5 disabled:opacity-40"
      >
        Next →
      </button>

      <span className="ml-auto text-9.5 text-faint font-mono">
        showing {from}–{to} of {total}
      </span>
      <MiniSelect
        value={String(size)}
        onChange={(v) => onSize(Number(v))}
        title="Rows per page"
        options={sizes.map((s) => ({ value: String(s), label: `${s} / page` }))}
      />
    </div>
  );
}
