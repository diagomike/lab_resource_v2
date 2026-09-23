import { describe, expect, it } from "vitest";
import { allocateNames, findNameClash, normalizeName, usedNumbers } from "./naming";

const range = (base: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${base} ${String(from + i).padStart(2, "0")}`);

describe("allocateNames", () => {
  it("numbers a fresh batch from 01", () => {
    expect(allocateNames("Workstation", [], 3)).toEqual(["Workstation 01", "Workstation 02", "Workstation 03"]);
  });

  it("continues after existing numbers instead of repeating 01…", () => {
    expect(allocateNames("Workstation", range("Workstation", 1, 20), 5)).toEqual(range("Workstation", 21, 25));
  });

  it("fills gaps first, then continues past the maximum", () => {
    const siblings = range("Workstation", 1, 20).filter((n) => n !== "Workstation 12");
    expect(allocateNames("Workstation", siblings, 5)).toEqual(["Workstation 12", "Workstation 21", "Workstation 22", "Workstation 23", "Workstation 24"]);
  });

  it("matches existing names regardless of case, spacing and padding", () => {
    // Numbers are read through any case, spacing and padding; the new name follows the
    // padding a sibling already uses ("003" → "004").
    expect(allocateNames("Workstation", ["workstation 1", "WORKSTATION   2", "Workstation 003"], 1)).toEqual(["Workstation 004"]);
  });

  it("treats a bare base name as slot 1", () => {
    expect(allocateNames("Computer", ["Computer"], 2)).toEqual(["Computer 02", "Computer 03"]);
  });

  it("keeps a single new item's bare name when nothing beside it uses the base", () => {
    expect(allocateNames("Lab", ["Store"], 1)).toEqual(["Lab"]);
  });

  it("numbers a single new item when the base is already in use", () => {
    expect(allocateNames("Computer", ["Computer 01", "Computer 02"], 1)).toEqual(["Computer 03"]);
  });

  it("widens the padding once the set passes 99, leaving existing names alone", () => {
    const names = allocateNames("Chair", range("Chair", 1, 99), 2);
    expect(names).toEqual(["Chair 100", "Chair 101"]);
  });

  it("R2-2: a second batch past 99 keeps the siblings' padding instead of re-padding the whole batch", () => {
    const names = allocateNames("Workstation Setup", range("Workstation Setup", 1, 75), 76);
    expect(names.slice(0, 2)).toEqual(["Workstation Setup 76", "Workstation Setup 77"]);
    expect(names.slice(23, 25)).toEqual(["Workstation Setup 99", "Workstation Setup 100"]);
    expect(names.at(-1)).toBe("Workstation Setup 151");
  });

  it("a fresh batch is padded to fit its own largest number, and later batches keep that width", () => {
    const first = allocateNames("Chair", [], 151);
    expect([first[0], first.at(-1)]).toEqual(["Chair 001", "Chair 151"]);
    expect(allocateNames("Chair", first, 2)).toEqual(["Chair 152", "Chair 153"]);
    expect(allocateNames("Chair", first.filter((n) => n !== "Chair 007"), 1)).toEqual(["Chair 007"]);
  });

  it("ignores names that merely start with the base", () => {
    expect(allocateNames("Table", ["Table Teacher", "Tables 01"], 1)).toEqual(["Table"]);
  });
});

describe("usedNumbers / findNameClash / normalizeName", () => {
  it("reads numbers only from exact base matches", () => {
    expect([...usedNumbers("PC", ["PC 3", "PC", "PC 3b", "Old PC 4"])].sort()).toEqual([1, 3]);
  });

  it("finds a clash against siblings, case- and space-insensitively", () => {
    expect(findNameClash(["computer 04 "], ["Computer 04"])).toBe("computer 04 ");
    expect(findNameClash(["Computer 05"], ["Computer 04"])).toBeNull();
  });

  it("finds a clash within the new names themselves", () => {
    expect(findNameClash(["A", "a"], [])).toBe("a");
  });

  it("normalizes whitespace and case", () => {
    expect(normalizeName("  Lab   ONE ")).toBe("lab one");
  });
});
