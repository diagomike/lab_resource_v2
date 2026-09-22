import { describe, expect, it } from "vitest";
import { Package } from "lucide-react";
import { categoryIconFor } from "./icons";

describe("categoryIconFor", () => {
  it("uses the Lucide package fallback for an unknown category icon key", () => {
    expect(categoryIconFor("not-a-real-key")).toBe(Package);
  });

  it("falls back for an undefined key too", () => {
    expect(categoryIconFor(undefined)).toBe(Package);
  });
});

describe("iconSearchText", () => {
  it("splits an icon name into words and adds synonyms, so 'curtain' finds Blinds", async () => {
    const { iconSearchText } = await import("./icons");
    expect(iconSearchText("Blinds")).toContain("curtain");
    expect(iconSearchText("MemoryStick")).toContain("memory stick");
    expect(iconSearchText("Building2")).toContain("building 2");
  });
});
