"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OrgNodeDto, PersonDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";
import { Panel, Screen, ErrorNote } from "@/components/ui";
import { PanelLoading } from "@/components/states";

/**
 * Real numbers derived from the two things this foundation phase actually has — the org
 * chart and the personnel register — rather than a dedicated /dashboard/admin endpoint.
 * A proper dashboard (labs, assets, requests) comes back once those modules exist; until
 * then this stays honest about what it can show.
 */
export default function AdminDashboardPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<OrgNodeDto[] | null>(null);
  const [people, setPeople] = useState<PersonDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<OrgNodeDto[]>("/org/nodes?scope=all"), api.get<PersonDto[]>("/people")])
      .then(([n, p]) => {
        setNodes(n);
        setPeople(p);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the dashboard"));
  }, []);

  const loading = nodes === null || people === null;

  return (
    <Screen>
      {error && <ErrorNote>{error}</ErrorNote>}
      {loading ? (
        <Panel title="Overview">
          <PanelLoading rows={4} />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
            <StatTile label="Org nodes" value={nodes.length} />
            <StatTile label="Vacant nodes" value={nodes.filter((n) => n.active && !n.occupant).length} tone="warn" />
            <StatTile label="People" value={people.length} />
            <StatTile label="Not yet registered" value={people.filter((p) => p.status !== "ACTIVE").length} tone="warn" />
          </div>

          <Panel
            title="Get started"
            actions={
              <button onClick={() => router.push("/admin/org-structure")} className="text-10.5 text-accent">
                open structure
              </button>
            }
          >
            {/* The four setup steps, in the order they depend on each other — each a link. */}
            <ol className="px-14 py-12 text-11.5 text-dim leading-loose list-decimal pl-32">
              {[
                ["Org structure", "/admin/org-structure", "draw the university, colleges, departments and offices, and assign each one's head."],
                ["People & roles", "/admin/people", "invite custodians, staff and the university offices; heads can invite their own department's people too."],
                ["Categories", "/categories", "the kinds of resources and their details; make labs and machines bookable, and choose what the public portal lists."],
                ["Access views", "/admin/access-views", "widen what a person or role may see — read-only if they should look but not touch."],
              ].map(([label, path, text]) => (
                <li key={path}>
                  <button onClick={() => router.push(path)} className="text-accent hover:underline">
                    {label}
                  </button>{" "}
                  — {text}
                </li>
              ))}
            </ol>
          </Panel>
        </>
      )}
    </Screen>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="bg-panel border border-border rounded-3 px-14 py-12">
      <div className="text-9.5 uppercase tracking-label text-faint font-semibold">{label}</div>
      <div className={`text-20 font-semibold mt-4 font-mono ${tone === "warn" && value > 0 ? "text-warn" : ""}`}>{value}</div>
    </div>
  );
}
