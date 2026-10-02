import type { ZodIssue } from "zod";

/**
 * A refused form, in words that say what to fix: "Contact person 2, email: give a
 * valid email address, like name@astu.edu.et." instead of "Validation failed". Used by
 * the server for every 400 it returns from a schema (lib/server/validate.ts), so the
 * message the page shows already names the field and the fix.
 */

/** Words for the field names that appear in our schemas. */
const FIELD_WORDS: Record<string, string> = {
  contacts: "Contact person",
  lines: "Line",
  windows: "Date",
  tasks: "Custodian",
  setups: "Lab setup",
  items: "Item",
  email: "email",
  contactEmail: "contact email",
  contactPhone: "contact phone",
  contactName: "contact person",
  organizationName: "institution",
  organisation: "institution",
  phone: "phone",
  name: "name",
  qty: "quantity",
  quantity: "quantity",
  sheetUrl: "cost breakdown link",
  receiptLink: "receipt link",
  amountSantim: "amount",
  categoryId: "category",
  homeNodeId: "unit",
  start: "start time",
  end: "end time",
  date: "date",
  password: "password",
  reference: "transaction reference",
};

function words(key: string): string {
  if (FIELD_WORDS[key]) return FIELD_WORDS[key];
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}

/** "contacts.1.email" → "Contact person 2, email". */
export function fieldPath(path: Array<string | number>): string {
  const out: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (typeof seg === "number") continue;
    const next = path[i + 1];
    out.push(typeof next === "number" ? `${words(seg)} ${next + 1}` : words(seg));
  }
  const text = out.join(", ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/** Zod's own default sentences, which name no fix — anything else is ours and kept. */
const ZOD_DEFAULT = /^(Required|Invalid( input| email| url| date| enum value.*| type)?|Expected .*|String must contain .*|Number must be .*|Array must contain .*)$/;

function fix(issue: ZodIssue): string {
  if (!ZOD_DEFAULT.test(issue.message)) return issue.message.replace(/\.$/, "");
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" || issue.received === "null" ? "fill this in" : `use a ${issue.expected} here`;
    case "invalid_string":
      if (issue.validation === "email") return "give a valid email address, like name@astu.edu.et";
      if (issue.validation === "url") return "paste the full link, starting with https://";
      return "check the format";
    case "too_small":
      if (issue.type === "string") return Number(issue.minimum) <= 1 ? "fill this in" : `use at least ${issue.minimum} characters`;
      if (issue.type === "array") return `add at least ${issue.minimum}`;
      return `use ${issue.minimum} or more`;
    case "too_big":
      if (issue.type === "string") return `keep it to ${issue.maximum} characters or fewer`;
      if (issue.type === "array") return `at most ${issue.maximum} are allowed`;
      return `use ${issue.maximum} or less`;
    case "invalid_enum_value":
      return `choose one of: ${issue.options.join(", ")}`;
    default:
      return "check this value";
  }
}

/** One issue as a sentence. */
export function issueSentence(issue: ZodIssue): string {
  const where = fieldPath(issue.path);
  const what = fix(issue);
  return where ? `${where}: ${what}.` : `${what.charAt(0).toUpperCase()}${what.slice(1)}.`;
}

/** Every issue (at most three, then "and N more"), as the message a page shows. */
export function readableIssues(issues: ZodIssue[]): string {
  if (!issues.length) return "Something in the form needs fixing.";
  const shown = issues.slice(0, 3).map(issueSentence);
  const more = issues.length - shown.length;
  return `Please fix: ${shown.join(" ")}${more > 0 ? ` And ${more} more.` : ""}`;
}
