import { describe, expect, it } from "vitest";
import { PEOPLE } from "./__fixtures__/seed";
import { BROWSE_VIEW_ID, SEED_VIEWS, defaultViewFor, resolveView, viewsForPerson, type AccessView } from "./views";
import type { Person } from "./types";
import type { RoleKind } from "@/lib/shared";

const who = (id: string): Person => PEOPLE.find((p) => p.id === id)!;
const person = (id: string, roles: RoleKind[]): Person => ({ id, name: id, homeOrgNodeId: "se", roles });

const view = (id: string, over: Partial<AccessView> = {}): AccessView => ({
  id,
  name: id,
  scope: "ORG_SUBTREE",
  audiences: [],
  canEdit: true,
  active: true,
  ...over,
});

describe("viewsForPerson", () => {
  it("matches on role", () => {
    const v = view("custodian-only", { audiences: [{ type: "ROLE", role: "CUSTODIAN" }] });
    expect(viewsForPerson(person("a", ["CUSTODIAN"]), [v])).toHaveLength(1);
    expect(viewsForPerson(person("b", ["STAFF"]), [v])).toHaveLength(0);
  });

  it("EVERYONE reaches anybody signed in, and nobody when signed out", () => {
    const v = view("browse", { audiences: [{ type: "EVERYONE" }] });
    expect(viewsForPerson(person("a", ["STUDENT"]), [v])).toHaveLength(1);
    expect(viewsForPerson(undefined, [v])).toHaveLength(0);
  });

  it("puts a view written for one person ahead of one written for their role", () => {
    const roleView = view("by-role", { audiences: [{ type: "ROLE", role: "CUSTODIAN" }] });
    const personView = view("by-person", { audiences: [{ type: "PERSON", personId: "a" }] });
    const order = viewsForPerson(person("a", ["CUSTODIAN"]), [roleView, personView]);
    expect(order.map((v) => v.id)).toEqual(["by-person", "by-role"]);
  });

  it("ignores views switched off", () => {
    const v = view("off", { active: false, audiences: [{ type: "EVERYONE" }] });
    expect(viewsForPerson(person("a", ["STAFF"]), [v])).toHaveLength(0);
  });
});

describe("resolveView", () => {
  const views = [view("mine", { audiences: [{ type: "ROLE", role: "CUSTODIAN" }] }), view("everyones", { audiences: [{ type: "EVERYONE" }] })];

  it("honours an explicit pick", () => {
    expect(resolveView(person("a", ["CUSTODIAN"]), views, "everyones")?.id).toBe("everyones");
  });

  it("falls back rather than stranding someone on a view that is not theirs", () => {
    // Switching persona must not leave the previous person's view selected.
    expect(resolveView(person("b", ["STAFF"]), views, "mine")?.id).toBe("everyones");
  });

  it("returns nothing when no view reaches the person at all", () => {
    expect(resolveView(person("c", ["STUDENT"]), [views[0]], null)).toBeUndefined();
  });
});

describe("the seeded views", () => {
  it("leave nobody without a way in — everyone can at least browse", () => {
    for (const p of PEOPLE) {
      const mine = viewsForPerson(p, SEED_VIEWS);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.some((v) => v.id === BROWSE_VIEW_ID)).toBe(true);
    }
  });

  it("land each stakeholder on the right default", () => {
    expect(defaultViewFor(who("u1"), SEED_VIEWS)?.scope).toBe("MY_CUSTODY");
    expect(defaultViewFor(who("p-head-se"), SEED_VIEWS)?.scope).toBe("ORG_SUBTREE");
    expect(defaultViewFor(who("p-property"), SEED_VIEWS)?.scope).toBe("UNIVERSITY");
  });

  it("never lands a working custodian in a read-only view", () => {
    // Every custodian is also STAFF, and the staff view is read only. Ranking by
    // role specificity rather than by view name is the only thing preventing that
    // from silently locking every laboratory holder out of their own register.
    for (const p of PEOPLE.filter((x) => x.roles.includes("CUSTODIAN"))) {
      expect(defaultViewFor(p, SEED_VIEWS)!.canEdit).toBe(true);
    }
  });

  it("lands a plain custodian on their own custody", () => {
    // Only for someone whose custodianship is their whole job — excluding anyone who
    // also holds a wider post (property administration), where that post should
    // decide what they open on instead. The main store keeper reaches UNIVERSITY
    // scope separately below, via the STORE_KEEPER-audienced "view-store".
    const plain = PEOPLE.filter((x) => x.roles.includes("CUSTODIAN") && !x.roles.includes("PROPERTY_ADMIN"));
    // 5 in this fixture (u1, u3, u4, u5, u6) — temp_works' own count was higher only
    // because its PEOPLE also spread in 13 real ASTU custodians via `...REAL_PEOPLE`,
    // which this test-only fixture deliberately excludes (see __fixtures__/seed.ts).
    expect(plain.length).toBeGreaterThan(3);
    for (const p of plain) {
      expect(defaultViewFor(p, SEED_VIEWS)!.scope).toBe("MY_CUSTODY");
    }
    expect(defaultViewFor(who("p-store"), SEED_VIEWS)!.scope).toBe("UNIVERSITY");
  });

  it("lands every head and dean somewhere they can act", () => {
    for (const p of PEOPLE.filter((x) => x.roles.includes("MANAGER"))) {
      expect(defaultViewFor(p, SEED_VIEWS)!.canEdit).toBe(true);
    }
  });

  it("makes the browse surface read only, since asking is the only action it offers", () => {
    expect(SEED_VIEWS.find((v) => v.id === BROWSE_VIEW_ID)?.canEdit).toBe(false);
  });

  it("gives a student nothing but the read-only browse view", () => {
    const mine = viewsForPerson(who("u7"), SEED_VIEWS);
    expect(mine.map((v) => v.id)).toEqual([BROWSE_VIEW_ID]);
    expect(mine.every((v) => !v.canEdit)).toBe(true);
  });
});
