import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MeContextDto, RoleKind } from "@/lib/shared";
import { ALL_CHAPTER_IDS, GENERAL_CHAPTERS, SCREEN_SECTION_IDS, helpChaptersFor, helpHrefFor } from "./audience";

const content = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/help/content.json"), "utf8")) as {
  chapters: Array<{ id: string; html: string; sections: Array<{ id: string }> }>;
};
const ALL = content.chapters.map((c) => c.id);

function me(roles: RoleKind[], post?: { kind: "DEPARTMENT" | "COLLEGE" | "UNIVERSITY" | "OFFICE"; code?: string }, views: MeContextDto["views"] = []): MeContextDto {
  return {
    user: { id: "u", email: "u@x", name: "U", phone: null, status: "ACTIVE", roles, mustChangePassword: false, emailNotifications: true },
    scope: post
      ? { nodeId: "n", name: "N", level: 1, kind: post.kind, code: post.code ?? null, isLeaf: true, isGlobal: false, isOccupant: true, reachableNodeCount: 1 }
      : null,
    canSeeCost: false,
    scopeMode: "ORG_SUBTREE",
    views,
  };
}
const roleChapters = (m: MeContextDto) => [...helpChaptersFor(m, ALL)].filter((c) => !(GENERAL_CHAPTERS as readonly string[]).includes(c)).sort();

describe("Help: who reads which chapter", () => {
  it("everyone gets the general chapters; a custodian adds the custodian and staff chapters only", () => {
    const set = helpChaptersFor(me(["CUSTODIAN", "STAFF"]), ALL);
    for (const g of GENERAL_CHAPTERS) expect(set.has(g)).toBe(true);
    expect(roleChapters(me(["CUSTODIAN", "STAFF"]))).toEqual(["custodian", "staff"]);
  });

  it("MANAGER is read through the post: head, dean, AVP (plus the portal), CMD", () => {
    expect(roleChapters(me(["MANAGER", "STAFF"], { kind: "DEPARTMENT" }))).toEqual(["head", "staff"]);
    expect(roleChapters(me(["MANAGER"], { kind: "COLLEGE" }))).toEqual(["dean-avp"]);
    expect(roleChapters(me(["MANAGER"], { kind: "UNIVERSITY" }))).toEqual(["dean-avp", "portal"]);
    expect(roleChapters(me(["MANAGER"], { kind: "OFFICE", code: "CMD" }))).toEqual(["dean-avp"]);
  });

  it("the offices, the ICT view, a student, and the admin", () => {
    expect(roleChapters(me(["PROCUREMENT"], { kind: "OFFICE", code: "PROC" }))).toEqual(["procurement"]);
    expect(roleChapters(me(["STORE_KEEPER", "STAFF"]))).toEqual(["staff", "store-keeper"]);
    expect(roleChapters(me(["STAFF"], undefined, [{ id: "v", name: "ICT", scope: "UNIVERSITY", canEdit: false }]))).toEqual(["ict-maintenance", "staff"]);
    expect(roleChapters(me(["STUDENT"]))).toEqual(["student"]);
    expect(helpChaptersFor(me(["SYS_ADMIN"]), ALL).size).toBe(ALL.length);
  });

  it("the top-bar Help opens the section for this screen and this role", () => {
    expect(helpHrefFor("/purchasing", helpChaptersFor(me(["MANAGER", "STAFF"], { kind: "DEPARTMENT" }), ALL))).toBe("/help?c=head#head--5-compile-a-purchase-request");
    expect(helpHrefFor("/purchasing", helpChaptersFor(me(["STORE_KEEPER", "STAFF"]), ALL))).toBe("/help?c=store-keeper#store-keeper--1-receive-arrived-stock");
    expect(helpHrefFor("/approvals", helpChaptersFor(me(["MANAGER"], { kind: "OFFICE", code: "CMD" }), ALL))).toBe("/help?c=dean-avp#dean-avp--1-purchase-requests");
    expect(helpHrefFor("/nowhere", helpChaptersFor(me(["STAFF"]), ALL))).toBe("/help");
  });

  it("the chapter list the top bar uses matches the built guide", () => {
    expect(ALL_CHAPTER_IDS).toEqual(ALL);
  });

  it("every section the screen map points at exists in the built guide", () => {
    const ids = new Set(content.chapters.flatMap((c) => [...c.html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])));
    expect(SCREEN_SECTION_IDS.filter((s) => !ids.has(s))).toEqual([]);
  });
});
