import { describe, expect, it } from "vitest";
import { ARRAY_OPERATORS, OPERATORS_BY_VARIANT, VALUELESS_OPERATORS } from "./config";
import { DEFAULT_PAGE_SIZE, applyTableState, decodeTableState, keysFor, type CodecOptions } from "./url-state";
import type { FilterVariant, TableState } from "./types";

/**
 * The codec is what makes a filtered view shareable, so its two obligations are tested
 * here directly: a round trip must be lossless, and a URL that has been hand-edited, gone
 * stale, or arrived truncated must degrade to a partial view rather than a blank screen.
 */

const opts: CodecOptions = {
  tableId: "assets",
  columns: [
    { id: "tag", variant: "text" },
    { id: "condition", variant: "multiSelect" },
    { id: "status", variant: "select" },
    { id: "cost", variant: "number" },
    { id: "purchased", variant: "date" },
  ],
};

const bare: CodecOptions = { columns: opts.columns };

function decode(query: string, o: CodecOptions = opts) {
  return decodeTableState(new URLSearchParams(query), o);
}
function encode(state: Partial<TableState>, o: CodecOptions = opts, existing = "") {
  const full: TableState = {
    q: "",
    filters: [],
    join: "and",
    sort: [],
    page: 1,
    size: DEFAULT_PAGE_SIZE,
    hidden: [],
    ...state,
  };
  return applyTableState(new URLSearchParams(existing), full, o);
}

describe("keysFor", () => {
  it("namespaces every key so two tables on one page cannot collide", () => {
    expect(keysFor("labs").q).toBe("labs_q");
    expect(keysFor("buildings").q).toBe("buildings_q");
    expect(keysFor().q).toBe("q");
  });
});

describe("decode", () => {
  it("reads an empty URL as the default state", () => {
    const s = decode("");
    expect(s).toEqual({ q: "", filters: [], join: "and", sort: [], page: 1, size: DEFAULT_PAGE_SIZE, hidden: [] });
  });

  it("reads a fully populated URL", () => {
    const f = encodeURIComponent(JSON.stringify([{ id: "condition", op: "inArray", v: ["GOOD", "FAIR"] }]));
    const s = decode(`assets_q=multimeter&assets_f=${f}&assets_join=or&assets_sort=tag.asc,cost.desc&assets_page=3&assets_size=50&assets_cols=purchased`);
    expect(s.q).toBe("multimeter");
    expect(s.filters).toEqual([{ id: "condition", op: "inArray", v: ["GOOD", "FAIR"] }]);
    expect(s.join).toBe("or");
    expect(s.sort).toEqual([{ id: "tag", desc: false }, { id: "cost", desc: true }]);
    expect(s.page).toBe(3);
    expect(s.size).toBe(50);
    expect(s.hidden).toEqual(["purchased"]);
  });

  it("only reads its own table's keys", () => {
    const s = decode("labs_q=other&assets_q=mine");
    expect(s.q).toBe("mine");
  });

  it("supports an unprefixed single-table page", () => {
    expect(decode("q=hello", bare).q).toBe("hello");
  });
});

describe("decode · degrades instead of blanking", () => {
  it("survives malformed JSON in the filter param", () => {
    const s = decode("assets_f=%5B%7Bnot-json&assets_q=kept");
    expect(s.filters).toEqual([]);
    expect(s.q).toBe("kept");
  });

  it("survives a filter param that is not an array", () => {
    expect(decode(`assets_f=${encodeURIComponent('{"id":"tag"}')}`).filters).toEqual([]);
  });

  it("drops a filter naming an unknown column and keeps the rest", () => {
    const f = encodeURIComponent(
      JSON.stringify([
        { id: "renamedAway", op: "contains", v: "x" },
        { id: "tag", op: "contains", v: "ASTU" },
      ]),
    );
    expect(decode(`assets_f=${f}`).filters).toEqual([{ id: "tag", op: "contains", v: "ASTU" }]);
  });

  it("drops an operator that is illegal for its column's variant", () => {
    // `contains` is a text operator; `cost` is a number column.
    const f = encodeURIComponent(
      JSON.stringify([
        { id: "cost", op: "contains", v: "12" },
        { id: "cost", op: "gt", v: "1000" },
      ]),
    );
    expect(decode(`assets_f=${f}`).filters).toEqual([{ id: "cost", op: "gt", v: "1000" }]);
  });

  it("drops an entry whose value shape does not match its operator", () => {
    const f = encodeURIComponent(
      JSON.stringify([
        { id: "condition", op: "inArray", v: "GOOD" }, // should be an array
        { id: "tag", op: "contains", v: ["ASTU"] }, // should be a string
        { id: "status", op: "eq", v: "ACTIVE" },
      ]),
    );
    expect(decode(`assets_f=${f}`).filters).toEqual([{ id: "status", op: "eq", v: "ACTIVE" }]);
  });

  it("keeps a valueless operator without needing a value", () => {
    const f = encodeURIComponent(JSON.stringify([{ id: "purchased", op: "isEmpty" }]));
    expect(decode(`assets_f=${f}`).filters).toEqual([{ id: "purchased", op: "isEmpty", v: "" }]);
  });

  it("ignores junk in sort, page, size and cols", () => {
    const s = decode("assets_sort=ghost.asc,tag.sideways,cost.desc&assets_page=-4&assets_size=0&assets_cols=tag,ghost");
    expect(s.sort).toEqual([{ id: "cost", desc: true }]);
    expect(s.page).toBe(1);
    expect(s.size).toBe(DEFAULT_PAGE_SIZE);
    expect(s.hidden).toEqual(["tag"]);
  });

  it("ignores a duplicated sort key rather than sorting twice by it", () => {
    expect(decode("assets_sort=tag.asc,tag.desc").sort).toEqual([{ id: "tag", desc: false }]);
  });
});

describe("encode", () => {
  it("writes nothing at all for an untouched table", () => {
    expect(encode({}).toString()).toBe("");
  });

  it("omits each value that is at its default", () => {
    const p = encode({ q: "x", join: "and", page: 1, size: DEFAULT_PAGE_SIZE });
    expect(p.get("assets_q")).toBe("x");
    expect(p.has("assets_join")).toBe(false);
    expect(p.has("assets_page")).toBe(false);
    expect(p.has("assets_size")).toBe(false);
  });

  it("treats a whitespace-only search as empty", () => {
    expect(encode({ q: "   " }).has("assets_q")).toBe(false);
  });

  it("carries through params it does not own", () => {
    const p = encode({ q: "mine" }, opts, "token=abc&labs_q=theirs");
    expect(p.get("token")).toBe("abc");
    expect(p.get("labs_q")).toBe("theirs");
    expect(p.get("assets_q")).toBe("mine");
  });

  it("clears its own stale keys when the state returns to default", () => {
    const p = encode({}, opts, "assets_q=old&assets_page=4&token=abc");
    expect(p.has("assets_q")).toBe(false);
    expect(p.has("assets_page")).toBe(false);
    expect(p.get("token")).toBe("abc");
  });
});

describe("value shape contract", () => {
  // Regression guard. `isRelativeToToday` is not one of ARRAY_OPERATORS, so its value is a
  // plain preset token; an early version of the value editor wrapped it in an array, which
  // encoded fine and was then silently DROPPED on the very next read — the filter appeared
  // to do nothing. Every operator's value shape has to match what the decoder accepts.
  it("keeps isRelativeToToday as a bare string and drops the array form", () => {
    const ok = encodeURIComponent(JSON.stringify([{ id: "purchased", op: "isRelativeToToday", v: "last7d" }]));
    expect(decode(`assets_f=${ok}`).filters).toEqual([{ id: "purchased", op: "isRelativeToToday", v: "last7d" }]);

    const wrapped = encodeURIComponent(JSON.stringify([{ id: "purchased", op: "isRelativeToToday", v: ["last7d"] }]));
    expect(decode(`assets_f=${wrapped}`).filters).toEqual([]);
  });

  it("round-trips every operator with the value shape ARRAY_OPERATORS prescribes", () => {
    for (const column of opts.columns) {
      const variant = (column.variant ?? "text") as FilterVariant;
      for (const op of OPERATORS_BY_VARIANT[variant]) {
        const v = VALUELESS_OPERATORS.includes(op)
          ? ""
          : ARRAY_OPERATORS.includes(op)
            ? ["a", "b"]
            : "a";
        const state: TableState = { ...decode(""), filters: [{ id: column.id, op, v }] };
        const back = decodeTableState(applyTableState(new URLSearchParams(), state, opts), opts);
        expect(back.filters, `${column.id}.${op}`).toEqual(state.filters);
      }
    }
  });
});

describe("round trip", () => {
  it("survives every field intact", () => {
    const state: TableState = {
      q: "digital multimeter",
      filters: [
        { id: "condition", op: "inArray", v: ["GOOD", "NEEDS_REPAIR"] },
        { id: "cost", op: "isBetween", v: ["1000", "50000"] },
        { id: "purchased", op: "isRelativeToToday", v: "last30d" },
        { id: "tag", op: "isNotEmpty", v: "" },
      ],
      join: "or",
      sort: [{ id: "cost", desc: true }, { id: "tag", desc: false }],
      page: 7,
      size: 100,
      hidden: ["status", "purchased"],
    };
    expect(decodeTableState(applyTableState(new URLSearchParams(), state, opts), opts)).toEqual(state);
  });

  it("survives for an unprefixed table too", () => {
    const state: TableState = { ...decode("", bare), q: "x", sort: [{ id: "tag", desc: true }], page: 2 };
    expect(decodeTableState(applyTableState(new URLSearchParams(), state, bare), bare)).toEqual(state);
  });
});
