import { describe, expect, it } from "vitest";
import { daysUntil, nextStep } from "./home-logic";

const none = { waiting: [], unfinished: [], dueSoon: [] };

describe("nextStep: the one thing to do now", () => {
  it("is nothing when nothing waits", () => {
    expect(nextStep(none)).toBeNull();
  });

  it("puts decisions others wait on first, in the order they hold work up", () => {
    const step = nextStep({
      ...none,
      waiting: [
        { kind: "needs", count: 4, path: "/purchasing?tab=needs" },
        { kind: "transfer", count: 3, path: "/approvals" },
        { kind: "lab-commit", count: 1, path: "/approvals?focus=lab-commit:x" },
      ],
      unfinished: [{ label: "Send your changes for B510-R8", detail: "4 changes not sent yet", path: "/places/x?tab=draft" }],
    });
    expect(step).toEqual({ title: "A lab's changes are waiting for your approval", body: expect.any(String), path: "/approvals?focus=lab-commit:x", action: "Review the changes" });
  });

  it("counts in words", () => {
    expect(nextStep({ ...none, waiting: [{ kind: "transfer", count: 3, path: "/approvals" }] })?.title).toBe("3 transfers are waiting for your decision");
  });

  it("then the person's own unfinished work", () => {
    expect(nextStep({ ...none, unfinished: [{ label: "Send your changes for B510-R8", detail: "4 changes not sent yet", path: "/p" }] })).toMatchObject({ title: "Send your changes for B510-R8", action: "Open it" });
  });

  it("then what falls due within a week", () => {
    const step = nextStep({ ...none, dueSoon: [{ itemName: "Oscilloscope 2", what: "Calibration", days: 20, path: "/a" }, { itemName: "Fire extinguisher 4", what: "Expiry", days: -2, path: "/b" }] });
    expect(step?.title).toBe("Expiry for Fire extinguisher 4 was due 2 days ago");
    expect(nextStep({ ...none, dueSoon: [{ itemName: "X", what: "Calibration", days: 20, path: "/a" }] })).toBeNull();
  });
});

describe("daysUntil", () => {
  it("counts calendar days", () => {
    const today = new Date("2026-10-02T21:00:00Z");
    expect(daysUntil("2026-10-02", today)).toBe(0);
    expect(daysUntil("2026-10-05", today)).toBe(3);
    expect(daysUntil("2026-09-30", today)).toBe(-2);
  });
});
