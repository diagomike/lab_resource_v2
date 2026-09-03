import { describe, expect, it } from "vitest";
import { buildCategoryPropsSchema, validatePropWrite, zodSchemaFor, type CategoryFieldRow } from "./category-props";

const numberField: CategoryFieldRow = { key: "ramGb", label: "RAM (GB)", type: "NUMBER", options: [] };
const boolField: CategoryFieldRow = { key: "hasGpu", label: "Has GPU", type: "BOOLEAN", options: [] };
const enumField: CategoryFieldRow = { key: "brand", label: "Brand", type: "ENUM", options: ["Dell", "HP"] };
const textField: CategoryFieldRow = { key: "serial", label: "Serial", type: "TEXT", options: [] };
const brokenEnumField: CategoryFieldRow = { key: "x", label: "X", type: "ENUM", options: [] };

describe("validatePropWrite", () => {
  it("rejects a field the category does not define", () => {
    expect(() => validatePropWrite(undefined, "anything")).toThrowError(/property defined by this category/);
  });

  it("always allows clearing a value to null, regardless of type", () => {
    expect(validatePropWrite(numberField, null)).toBeNull();
    expect(validatePropWrite(enumField, null)).toBeNull();
  });

  it("accepts a finite number for a NUMBER field and rejects a non-numeric one", () => {
    expect(validatePropWrite(numberField, 16)).toBe(16);
    expect(() => validatePropWrite(numberField, "16" as unknown as number)).toThrowError(/must be numeric/);
    expect(() => validatePropWrite(numberField, Number.POSITIVE_INFINITY)).toThrowError(/must be numeric/);
  });

  it("accepts a boolean for a BOOLEAN field and rejects anything else", () => {
    expect(validatePropWrite(boolField, true)).toBe(true);
    expect(() => validatePropWrite(boolField, "true" as unknown as boolean)).toThrowError(/must be yes or no/);
  });

  it("accepts a listed option for an ENUM field and rejects one outside it", () => {
    expect(validatePropWrite(enumField, "Dell")).toBe("Dell");
    expect(() => validatePropWrite(enumField, "Lenovo")).toThrowError(/Choose a valid brand value/);
  });

  it("a misconfigured ENUM field with no options fails closed rather than accepting anything", () => {
    expect(() => validatePropWrite(brokenEnumField, "anything")).toThrow();
  });

  it("accepts any string for a TEXT field", () => {
    expect(validatePropWrite(textField, "SN-001")).toBe("SN-001");
    expect(validatePropWrite(textField, "")).toBe("");
  });

  it("a bulk edit spanning two categories that share a key fails the one that doesn't define it", () => {
    // Simulates mutate.ts's per-item resolution: field is looked up per item's own
    // category, so one item in the selection can be undefined even when another isn't.
    expect(validatePropWrite(numberField, 5)).toBe(5);
    expect(() => validatePropWrite(undefined, 5)).toThrow();
  });
});

describe("buildCategoryPropsSchema", () => {
  it("makes every field optional — a fresh item's all-null props object still parses", () => {
    const schema = buildCategoryPropsSchema([numberField, boolField, enumField]);
    expect(schema.safeParse({ ramGb: null, hasGpu: null, brand: null }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("still enforces per-field types when a value is present", () => {
    const schema = buildCategoryPropsSchema([numberField]);
    expect(schema.safeParse({ ramGb: 32 }).success).toBe(true);
    expect(schema.safeParse({ ramGb: "32" }).success).toBe(false);
  });
});

describe("zodSchemaFor", () => {
  it("always allows null on top of the base type", () => {
    expect(zodSchemaFor(numberField).safeParse(null).success).toBe(true);
    expect(zodSchemaFor(numberField).safeParse(5).success).toBe(true);
    expect(zodSchemaFor(numberField).safeParse("5").success).toBe(false);
  });
});
