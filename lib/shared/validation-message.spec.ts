import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldPath, readableIssues } from "./validation-message";

const issuesOf = (schema: z.ZodTypeAny, value: unknown) => {
  const r = schema.safeParse(value);
  if (r.success) throw new Error("expected a failure");
  return r.error.issues;
};

describe("readable validation messages", () => {
  it("names the item in a list, one-based", () => {
    expect(fieldPath(["contacts", 1, "email"])).toBe("Contact person 2, email");
  });

  it("turns zod's defaults into a fix", () => {
    const schema = z.object({ contacts: z.array(z.object({ name: z.string().min(2), email: z.string().email() })) });
    const msg = readableIssues(issuesOf(schema, { contacts: [{ name: "Al", email: "a@b.co" }, { name: "B", email: "nope" }] }));
    expect(msg).toContain("Contact person 2, name: use at least 2 characters.");
    expect(msg).toContain("Contact person 2, email: give a valid email address, like name@astu.edu.et.");
  });

  it("keeps our own messages", () => {
    const schema = z.object({ sheetUrl: z.string().url("Paste the full link to the cost breakdown.") });
    expect(readableIssues(issuesOf(schema, { sheetUrl: "x" }))).toBe("Please fix: Cost breakdown link: Paste the full link to the cost breakdown.");
  });

  it("says when something is missing", () => {
    expect(readableIssues(issuesOf(z.object({ phone: z.string() }), {}))).toBe("Please fix: Phone: fill this in.");
  });
});
