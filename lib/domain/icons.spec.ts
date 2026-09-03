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
