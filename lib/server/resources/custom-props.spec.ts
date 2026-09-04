import { describe, expect, it } from "vitest";
import { assertNoCollision, assertValidCustomKey, normalizeKey, validateCustomPropValue } from "./custom-props";

describe("assertValidCustomKey", () => {
  it("accepts a normal name, trimmed", () => {
    expect(assertValidCustomKey("  Serial Number 2  ")).toBe("Serial Number 2");
  });

  it("rejects empty or whitespace-only input", () => {
    expect(() => assertValidCustomKey("")).toThrow();
    expect(() => assertValidCustomKey("   ")).toThrow();
  });

  it("rejects a key starting with a digit or containing unsafe characters", () => {
    expect(() => assertValidCustomKey("1st")).toThrow();
    expect(() => assertValidCustomKey("bad:key")).toThrow();
    expect(() => assertValidCustomKey("quote\"key")).toThrow();
  });

  it("rejects a key longer than the pattern allows", () => {
    expect(() => assertValidCustomKey("A".repeat(60))).toThrow();
  });

  it("allows spaces, hyphens and underscores", () => {
    expect(assertValidCustomKey("Warranty-Expiry_2")).toBe("Warranty-Expiry_2");
  });
});

describe("normalizeKey", () => {
  it("treats casing and spacing as insignificant", () => {
    expect(normalizeKey("Serial Number")).toBe(normalizeKey("serial_number"));
    expect(normalizeKey("Serial Number")).toBe(normalizeKey("SERIAL-NUMBER"));
  });
});

describe("assertNoCollision", () => {
  it("rejects a key matching an existing category field, normalized", () => {
    expect(() => assertNoCollision("Brand", ["brand"], [])).toThrow();
  });

  it("rejects a key matching this item's own existing custom property, normalized", () => {
    expect(() => assertNoCollision("Serial Number", [], ["serial_number"])).toThrow();
  });

  it("allows a genuinely new key", () => {
    expect(() => assertNoCollision("Warranty Expiry", ["brand", "type"], ["serial"])).not.toThrow();
  });
});

describe("validateCustomPropValue", () => {
  it("passes null through regardless of declared type", () => {
    expect(validateCustomPropValue("NUMBER", null)).toBeNull();
    expect(validateCustomPropValue("BOOLEAN", null)).toBeNull();
    expect(validateCustomPropValue("TEXT", null)).toBeNull();
  });

  it("validates a NUMBER value strictly", () => {
    expect(validateCustomPropValue("NUMBER", 42)).toBe(42);
    expect(() => validateCustomPropValue("NUMBER", "42")).toThrow();
    expect(() => validateCustomPropValue("NUMBER", true)).toThrow();
  });

  it("validates a BOOLEAN value strictly", () => {
    expect(validateCustomPropValue("BOOLEAN", true)).toBe(true);
    expect(() => validateCustomPropValue("BOOLEAN", "true")).toThrow();
  });

  it("accepts any string for TEXT", () => {
    expect(validateCustomPropValue("TEXT", "hello")).toBe("hello");
    expect(() => validateCustomPropValue("TEXT", 42)).toThrow();
  });
});
