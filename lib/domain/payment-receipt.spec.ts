import { describe, expect, it } from "vitest";
import { paidAfter, parseAmountToSantim, parseReceiptTime, receiverMatches, statusSaysPaid } from "./payment-receipt";

describe("parseAmountToSantim", () => {
  it("reads numbers and the ways banks print amounts, in integer santim", () => {
    expect(parseAmountToSantim(1500)).toBe(150_000);
    expect(parseAmountToSantim(1500.5)).toBe(150_050);
    expect(parseAmountToSantim(0.1 + 0.2)).toBe(30);
    expect(parseAmountToSantim("ETB 18,750.00")).toBe(1_875_000);
    expect(parseAmountToSantim("1500.5 Birr")).toBe(150_050);
    expect(parseAmountToSantim("1500.567")).toBe(150_056);
    expect(parseAmountToSantim("ETB")).toBeNull();
    expect(parseAmountToSantim(null)).toBeNull();
    expect(parseAmountToSantim(-5)).toBeNull();
  });
});

describe("parseReceiptTime", () => {
  const addis = (iso: string) => new Date(`${iso}+03:00`).toISOString();

  it("reads receipt times as Addis Ababa civil time unless a zone is given", () => {
    expect(parseReceiptTime("2025-06-15 14:30:00")?.at.toISOString()).toBe(addis("2025-06-15T14:30:00"));
    expect(parseReceiptTime("2025-06-15T11:30:00Z")?.at.toISOString()).toBe("2025-06-15T11:30:00.000Z");
    expect(parseReceiptTime("15-06-2025 14:30:00")?.at.toISOString()).toBe(addis("2025-06-15T14:30:00"));
  });

  it("tells day-first from month-first", () => {
    // CBE: American, with AM/PM.
    expect(parseReceiptTime("6/7/2025, 2:30:00 PM")?.at.toISOString()).toBe(addis("2025-06-07T14:30:00"));
    // A part above 12 settles it either way.
    expect(parseReceiptTime("25/06/2025 09:05")?.at.toISOString()).toBe(addis("2025-06-25T09:05:00"));
    expect(parseReceiptTime("06/25/2025 09:05")?.at.toISOString()).toBe(addis("2025-06-25T09:05:00"));
    // Otherwise day-first.
    expect(parseReceiptTime("06/07/2025 09:05")?.at.toISOString()).toBe(addis("2025-07-06T09:05:00"));
    expect(parseReceiptTime("12:00 AM 1/2/2025")?.at.toISOString()).toBe(addis("2025-01-02T00:00:00"));
  });

  it("reads month names, remembers when there was no time, and refuses nonsense", () => {
    expect(parseReceiptTime("Jun 15, 2025 2:30 PM")?.at.toISOString()).toBe(addis("2025-06-15T14:30:00"));
    expect(parseReceiptTime("2025-06-15")).toMatchObject({ hasTime: false });
    expect(parseReceiptTime("31/02/2025")).toBeNull();
    expect(parseReceiptTime("yesterday")).toBeNull();
    expect(parseReceiptTime(12345)).toBeNull();
  });
});

describe("paidAfter", () => {
  const quoteSentAt = new Date("2025-06-15T08:00:00Z"); // 11:00 in Addis

  it("compares instants, allowing a minute for the receipt's rounding", () => {
    expect(paidAfter({ at: new Date("2025-06-15T08:00:30Z"), hasTime: true }, quoteSentAt)).toBe(true);
    expect(paidAfter({ at: new Date("2025-06-15T07:59:30Z"), hasTime: true }, quoteSentAt)).toBe(true);
    expect(paidAfter({ at: new Date("2025-06-15T07:30:00Z"), hasTime: true }, quoteSentAt)).toBe(false);
  });

  it("compares civil dates when the receipt had no time", () => {
    expect(paidAfter(parseReceiptTime("2025-06-15")!, quoteSentAt)).toBe(true);
    expect(paidAfter(parseReceiptTime("2025-06-14")!, quoteSentAt)).toBe(false);
  });
});

describe("receiverMatches", () => {
  const config = { account: "1000123456789", name: "Adama Science and Technology University" };

  it("checks every digit run a masked account shows, at the right end", () => {
    expect(receiverMatches({ account: "1****6789", name: null }, config)).toBe(true);
    expect(receiverMatches({ account: "1000123456789", name: null }, config)).toBe(true);
    expect(receiverMatches({ account: "****6789", name: null }, config)).toBe(true);
    expect(receiverMatches({ account: "2****6789", name: null }, config)).toBe(false);
    expect(receiverMatches({ account: "1****6780", name: null }, config)).toBe(false);
    // Too few digits to mean anything.
    expect(receiverMatches({ account: "****789", name: config.name }, config)).toBe(false);
  });

  it("falls back to the holder's name only when no account digits are shown", () => {
    expect(receiverMatches({ account: null, name: "ADAMA SCIENCE AND TECHNOLOGY UNIVERSITY" }, config)).toBe(true);
    expect(receiverMatches({ account: null, name: "Adama Science & Technology University, Adama" }, config)).toBe(true);
    expect(receiverMatches({ account: null, name: "Someone Else PLC" }, config)).toBe(false);
    expect(receiverMatches({ account: null, name: "Adama" }, config)).toBe(false);
    expect(receiverMatches({ account: null, name: null }, config)).toBe(false);
    expect(receiverMatches({ account: "1****6789", name: null }, { account: null, name: config.name })).toBe(false);
  });
});

describe("statusSaysPaid", () => {
  it("accepts a missing or positive status and refuses anything else", () => {
    expect([undefined, "Completed", "SUCCESS", "Verified"].map(statusSaysPaid)).toEqual([true, true, true, true]);
    expect(["Pending", "Failed", "Unsuccessful", "Not completed", "Reversed"].map(statusSaysPaid)).toEqual([false, false, false, false, false]);
  });
});
