/**
 * temp_works/src/lib/purchasing.test.ts exercises its Zustand store's stateful
 * actions (raiseNeed, compilePurchase, decidePurchase, advancePurchase,
 * receivePurchaseLine) end to end — none of it calls this file's pure functions in
 * isolation, and that stateful write path is rejected for Phase 3 (it becomes a
 * server module in a later phase, per ~/.claude/plans/wait-i-want-gentle-haven.md's
 * Phase 14). This is a fresh, minimal spec for just the pure functions ported here.
 */
import { describe, expect, it } from "vitest";
import { canCompile, canRaiseNeed, canReceive, canRunPipeline, emptyLine, isEditable, isFinished, lineTotal, nextStage, receivedProgress, requestTotal, type PurchaseLine, type PurchaseRequest } from "./purchasing";
import type { Person } from "./types";

const person = (roles: Person["roles"], homeOrgNodeId: string | null = "se"): Person => ({ id: "x", name: "x", homeOrgNodeId, roles });

describe("who may do what", () => {
  it("lets anybody attached to a unit raise a need, except a student", () => {
    expect(canRaiseNeed(person(["STAFF"]))).toBe(true);
    expect(canRaiseNeed(person(["STUDENT"]))).toBe(false);
    expect(canRaiseNeed(person(["STAFF"], null))).toBe(false);
    expect(canRaiseNeed(undefined)).toBe(false);
  });

  it("reserves compiling a request for a head or admin", () => {
    expect(canCompile(person(["MANAGER"]))).toBe(true);
    expect(canCompile(person(["SYS_ADMIN"]))).toBe(true);
    expect(canCompile(person(["CUSTODIAN"]))).toBe(false);
  });

  it("reserves the pipeline for procurement", () => {
    expect(canRunPipeline(person(["PROCUREMENT"]))).toBe(true);
    expect(canRunPipeline(person(["MANAGER"]))).toBe(false);
  });

  it("reserves receiving for the store keeper", () => {
    expect(canReceive(person(["STORE_KEEPER"]))).toBe(true);
    expect(canReceive(person(["PROPERTY_ADMIN"]))).toBe(false);
  });
});

describe("nextStage — the reporting pipeline", () => {
  it("walks the four reporting stages in order", () => {
    expect(nextStage("ORDER_PLACED")).toBe("BUYER_FOUND");
    expect(nextStage("BUYER_FOUND")).toBe("ON_DELIVERY");
    expect(nextStage("ON_DELIVERY")).toBe("IN_STORE");
    expect(nextStage("IN_STORE")).toBeNull();
  });

  it("has no next stage from a decision state", () => {
    expect(nextStage("APPROVING")).toBeNull();
    expect(nextStage("DRAFT")).toBeNull();
  });
});

describe("isFinished / isEditable", () => {
  it("treats CLOSED/REJECTED/CANCELLED as finished, nothing else", () => {
    expect(isFinished("CLOSED")).toBe(true);
    expect(isFinished("REJECTED")).toBe(true);
    expect(isFinished("CANCELLED")).toBe(true);
    expect(isFinished("IN_STORE")).toBe(false);
  });

  it("is editable only in DRAFT or REVISING", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("REVISING")).toBe(true);
    expect(isEditable("APPROVING")).toBe(false);
  });
});

describe("sums", () => {
  const line = (over: Partial<PurchaseLine> = {}): PurchaseLine => ({ id: "l1", name: "Balance", qty: 2, fromNeedIds: [], ...over });

  it("has no total when cost is not yet estimated", () => {
    expect(lineTotal(line())).toBeUndefined();
  });

  it("multiplies cost by quantity once costed", () => {
    expect(lineTotal(line({ estimatedUnitCost: 500 }))).toBe(1000);
  });

  it("sums only the costed lines of a request, ignoring the rest", () => {
    const request: PurchaseRequest = {
      id: "r1",
      reference: "PR-1",
      orgNodeId: "se",
      raisedById: "u1",
      createdAt: "",
      title: "t",
      stage: "DRAFT",
      steps: [],
      history: [],
      lines: [line({ id: "a", estimatedUnitCost: 500, qty: 2 }), line({ id: "b" })],
    };
    expect(requestTotal(request)).toBe(1000);
  });

  it("has no total at all when nothing is costed", () => {
    const request: PurchaseRequest = { id: "r1", reference: "PR-1", orgNodeId: "se", raisedById: "u1", createdAt: "", title: "t", stage: "DRAFT", steps: [], history: [], lines: [line()] };
    expect(requestTotal(request)).toBeUndefined();
  });
});

describe("receivedProgress", () => {
  it("is not complete until every ordered unit is received", () => {
    const request: PurchaseRequest = {
      id: "r1",
      reference: "PR-1",
      orgNodeId: "se",
      raisedById: "u1",
      createdAt: "",
      title: "t",
      stage: "IN_STORE",
      steps: [],
      history: [],
      lines: [{ id: "a", name: "x", qty: 2, fromNeedIds: [], receivedQty: 1 }],
    };
    expect(receivedProgress(request)).toEqual({ received: 1, ordered: 2, complete: false });
  });

  it("is complete once received meets or exceeds ordered", () => {
    const request: PurchaseRequest = {
      id: "r1",
      reference: "PR-1",
      orgNodeId: "se",
      raisedById: "u1",
      createdAt: "",
      title: "t",
      stage: "IN_STORE",
      steps: [],
      history: [],
      lines: [{ id: "a", name: "x", qty: 2, fromNeedIds: [], receivedQty: 2 }],
    };
    expect(receivedProgress(request).complete).toBe(true);
  });
});

describe("emptyLine", () => {
  it("starts at quantity 1 with no needs answered yet", () => {
    expect(emptyLine("l1")).toEqual({ id: "l1", name: "", qty: 1, fromNeedIds: [] });
  });
});
