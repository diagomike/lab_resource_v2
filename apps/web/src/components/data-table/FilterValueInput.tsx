import { useEffect, useRef, useState } from "react";
import { RELATIVE_PRESETS, VALUELESS_OPERATORS } from "./config";
import { MiniSelect } from "./Dropdown";
import { FacetedFilter } from "./FacetedFilter";
import type { FilterOperator, FilterVariant, Option } from "./types";

/**
 * The value editor for one filter, chosen by variant and operator. The header's inline
 * filter row and the advanced builder both render this, so a date range means the same
 * thing and looks the same wherever you set it.
 */

const INPUT_CLASS =
  "w-full bg-panel border border-border2 rounded-2 h-20 px-6 text-10 outline-none focus:border-accent";

/**
 * Keeps typing instant while writing to the URL only once the user pauses. Without this
 * every keystroke would be a history/render round trip; with a naive `value={urlValue}` the
 * caret would also jump whenever the debounced write landed.
 */
function DebouncedInput({
  value,
  onCommit,
  type = "text",
  placeholder,
  delay = 300,
  className = INPUT_CLASS,
}: {
  value: string;
  onCommit: (value: string) => void;
  type?: "text" | "number" | "date";
  placeholder?: string;
  delay?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(value);

  // Adopt an externally-driven change (back button, Clear all, a pasted link) without
  // stomping on what is being typed right now.
  useEffect(() => {
    if (value !== latest.current) {
      latest.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <input
      type={type}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        latest.current = next;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onCommit(next), delay);
      }}
      onBlur={() => {
        clearTimeout(timer.current);
        if (draft !== value) onCommit(draft);
      }}
      className={className}
    />
  );
}

export function FilterValueInput({
  variant,
  op,
  value,
  options,
  unit,
  range,
  onChange,
  compact = false,
}: {
  variant: FilterVariant;
  op: FilterOperator;
  value: string | string[];
  options: Option[];
  unit?: string;
  range?: [number, number];
  onChange: (value: string | string[]) => void;
  /** The header row is one column wide; the builder has more room. */
  compact?: boolean;
}) {
  const one = Array.isArray(value) ? (value[0] ?? "") : value;
  const two = Array.isArray(value) ? (value[1] ?? "") : "";
  const many = Array.isArray(value) ? value : value ? [value] : [];

  if (VALUELESS_OPERATORS.includes(op)) {
    return <span className="text-10 text-faint px-6 leading-20 block">—</span>;
  }

  if (op === "inArray" || op === "notInArray") {
    return <FacetedFilter options={options} selected={many} onChange={onChange} width={compact ? "220px" : "240px"} />;
  }

  if (variant === "select") {
    return (
      <FacetedFilter
        options={options}
        selected={one ? [one] : []}
        onChange={(vals) => onChange(vals[0] ?? "")}
        single
        width={compact ? "220px" : "240px"}
      />
    );
  }

  if (variant === "boolean") {
    return (
      <MiniSelect
        value={one}
        onChange={onChange}
        className="w-full"
        options={[
          { value: "", label: "any" },
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]}
      />
    );
  }

  if (op === "isRelativeToToday") {
    return (
      <MiniSelect
        value={one}
        // A single preset token, NOT an array — `isRelativeToToday` is not one of
        // ARRAY_OPERATORS, so url-state.ts's decoder requires a string here and would drop
        // the filter on the next read if this wrapped it.
        onChange={(v) => onChange(v)}
        className="w-full"
        options={[{ value: "", label: "pick a window…" }, ...RELATIVE_PRESETS.map((p) => ({ value: p.value, label: p.label }))]}
      />
    );
  }

  const dateLike = variant === "date" || variant === "dateRange";

  if (op === "isBetween") {
    return (
      <div className="flex items-center gap-4">
        <DebouncedInput
          type={dateLike ? "date" : "number"}
          value={one}
          placeholder={dateLike ? undefined : range ? String(range[0]) : "from"}
          onCommit={(v) => onChange([v, two])}
        />
        <span className="text-9.5 text-faint shrink-0">–</span>
        <DebouncedInput
          type={dateLike ? "date" : "number"}
          value={two}
          placeholder={dateLike ? undefined : range ? String(range[1]) : "to"}
          onCommit={(v) => onChange([one, v])}
        />
        {unit && !dateLike && <span className="text-9.5 text-faint shrink-0">{unit}</span>}
      </div>
    );
  }

  if (dateLike) {
    return <DebouncedInput type="date" value={one} onCommit={onChange} />;
  }

  if (variant === "number" || variant === "range") {
    return (
      <div className="flex items-center gap-4">
        <DebouncedInput type="number" value={one} placeholder={unit ?? "value"} onCommit={onChange} />
        {unit && <span className="text-9.5 text-faint shrink-0">{unit}</span>}
      </div>
    );
  }

  return <DebouncedInput value={one} placeholder="filter…" onCommit={onChange} />;
}

export { DebouncedInput, INPUT_CLASS };
