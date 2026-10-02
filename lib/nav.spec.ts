import { describe, expect, it } from "vitest";
import type { CapabilitiesDto, RoleKind } from "@/lib/shared";
import { canAccessPath, landingPathFor, navFor, type NavFacts } from "./nav";

const NONE: CapabilitiesDto = {
  isAdmin: false,
  isPropertyAdmin: false,
  isProcurement: false,
  isStoreKeeper: false,
  isCustodian: false,
  isAdaa: false,
  headOf: [],
  deanOf: [],
  isAvp: false,
  officeCodes: [],
  adaaCollegeId: null,
  managesPlacesIn: [],
  managesStoresIn: [],
};

function facts(roles: RoleKind[], caps: Partial<CapabilitiesDto> = {}): NavFacts {
  return { roles, caps: { ...NONE, ...caps } };
}

const keys = (f: NavFacts) => navFor(f).flatMap((g) => g.items.map((i) => i.key));

const PEOPLE: Record<string, NavFacts> = {
  custodian: facts(["CUSTODIAN"], { isCustodian: true }),
  head: facts(["MANAGER"], { headOf: ["cse"], managesPlacesIn: ["cse"] }),
  adaa: facts(["ADAA"], { isAdaa: true, adaaCollegeId: "coeec", managesStoresIn: ["coeec"] }),
  avp: facts(["MANAGER"], { isAvp: true }),
  propertyAdmin: facts(["PROPERTY_ADMIN"], { isPropertyAdmin: true, managesPlacesIn: ["astu"] }),
  procurement: facts(["PROCUREMENT"], { isProcurement: true }),
  storeKeeper: facts(["STORE_KEEPER"], { isStoreKeeper: true }),
  admin: facts(["SYS_ADMIN"], { isAdmin: true, managesPlacesIn: ["astu", "cse"] }),
};

describe("the sidebar shows each person what they use (the plan's matrix)", () => {
  it("everyone gets Home, Resources, Approvals and their own section", () => {
    for (const f of Object.values(PEOPLE)) {
      expect(keys(f)).toEqual(expect.arrayContaining(["home", "register", "approvals", "help", "profile"]));
    }
  });

  it("a custodian: their labs, bookings, needs, outside tasks and categories — no Insights, History or People", () => {
    const k = keys(PEOPLE.custodian);
    expect(k).toEqual(expect.arrayContaining(["places", "schedule", "purchasing", "external-requests", "categories"]));
    expect(k).not.toContain("dashboard");
    expect(k).not.toContain("change-log");
    expect(k).not.toContain("admin-people");
    expect(k).not.toContain("admin-org-structure");
  });

  it("a head sees their whole unit's work, and their people", () => {
    expect(keys(PEOPLE.head)).toEqual(
      expect.arrayContaining(["places", "schedule", "purchasing", "external-requests", "categories", "dashboard", "change-log", "admin-people"]),
    );
    expect(keys(PEOPLE.head)).not.toContain("admin-org-structure");
  });

  it("the ADAA manages the college's stores and categories, and reads Insights and History — no bookings or buying", () => {
    const k = keys(PEOPLE.adaa);
    expect(k).toEqual(expect.arrayContaining(["places", "categories", "dashboard", "change-log"]));
    expect(k).not.toContain("schedule");
    expect(k).not.toContain("purchasing");
  });

  it("procurement buys and nothing else; the store keeper runs stores and arrivals", () => {
    expect(keys(PEOPLE.procurement)).toEqual(["home", "register", "approvals", "purchasing", "help", "profile"]);
    expect(keys(PEOPLE.storeKeeper)).toEqual(expect.arrayContaining(["places", "purchasing"]));
    expect(keys(PEOPLE.storeKeeper)).not.toContain("categories");
  });

  it("only the admin sees Organisation", () => {
    for (const [name, f] of Object.entries(PEOPLE)) expect(keys(f).includes("admin-org-structure")).toBe(name === "admin");
  });

  it("an outside requester gets no workspace at all", () => {
    expect(keys(facts(["EXTERNAL"]))).toEqual(["help", "profile"]);
  });
});

describe("the route guard reads the same rule", () => {
  it("refuses what the sidebar hides, allows what it shows", () => {
    expect(canAccessPath("/admin/org-structure", PEOPLE.head)).toBe(false);
    expect(canAccessPath("/dashboard", PEOPLE.custodian)).toBe(false);
    expect(canAccessPath("/places/abc", PEOPLE.custodian)).toBe(true);
    expect(canAccessPath("/purchasing", PEOPLE.adaa)).toBe(false);
  });

  it("leaves screens that aren't nav destinations to the API", () => {
    expect(canAccessPath("/help", PEOPLE.procurement)).toBe(true);
    expect(canAccessPath("/me/profile", facts(["EXTERNAL"]))).toBe(true);
  });
});

describe("landing", () => {
  it("everyone lands on Home; an outside requester on the portal", () => {
    expect(landingPathFor(["CUSTODIAN"])).toBe("/home");
    expect(landingPathFor(["SYS_ADMIN"])).toBe("/home");
    expect(landingPathFor(["EXTERNAL"])).toBe("/portal/requests");
  });
});
