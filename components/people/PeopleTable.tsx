"use client";

import { useMemo } from "react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import type { PersonDto } from "@/lib/shared";
import { Tag, Button } from "@/components/ui";

// v9 registers features explicitly — this table only ever needs client-side sort.
// Filtering (search/role/status) is done by the caller before rows ever reach here,
// same call the register's ResourceTable makes for scope/status: keep the row model
// simple, do the narrowing once, upstream.
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });

const helper = createColumnHelper<typeof features, PersonDto>();

export function PeopleTable({
  rows,
  sorting,
  onSortingChange,
  isAdmin,
  onManage,
  onResendInvite,
}: {
  rows: PersonDto[];
  sorting: SortingState;
  onSortingChange: (s: SortingState) => void;
  isAdmin: boolean;
  onManage: (p: PersonDto) => void;
  onResendInvite: (p: PersonDto) => void;
}) {
  const columns = useMemo(() => {
    // v9's `getCanSort()` hard-requires `accessorFn` (rowSortingFeature.utils.ts:
    // `!!column.accessorFn`) — a `.display()` column can never be sortable no matter
    // what `sortFn` it carries, unlike v8. Sortable columns are `.accessor()`
    // (returning the plain string TanStack sorts by default); the rest stay
    // `.display()`. Each is cast to `ColumnDef<..., any>` because TanStack's own
    // array-literal contextual typing cannot unify an `.accessor<string>()`'s
    // `Value` generic against a `.display()`'s `unknown` one in the same array —
    // a known friction point, not a sign either column is actually wrong.
    const cols: ColumnDef<typeof features, PersonDto, unknown>[] = [
      helper.accessor((p) => p.name, {
        id: "name",
        header: "Name",
        cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
      }) as ColumnDef<typeof features, PersonDto, unknown>,

      helper.accessor((p) => p.email, {
        id: "email",
        header: "Email",
        cell: ({ getValue }) => <span className="font-mono text-10.5">{getValue()}</span>,
      }) as ColumnDef<typeof features, PersonDto, unknown>,

      helper.display({
        id: "roles",
        header: "Roles",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-3 justify-end">
            {row.original.roles.map((r) => (
              <Tag key={r}>{r.toLowerCase()}</Tag>
            ))}
          </div>
        ),
      }),

      helper.display({
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.original.status;
          return <Tag tone={status === "ACTIVE" ? "good" : status === "INVITED" ? "warn" : "bad"}>{status.toLowerCase()}</Tag>;
        },
      }),

      helper.accessor((p) => p.occupiesNodeName ?? p.homeNodeName ?? "", {
        id: "unit",
        header: "Department / occupies",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="text-10.5">
              {p.occupiesNodeName ? <span className="text-text">Heads {p.occupiesNodeName}</span> : (p.homeNodeName ?? <span className="text-faint">—</span>)}
            </div>
          );
        },
      }) as ColumnDef<typeof features, PersonDto, unknown>,

      helper.display({
        id: "invitedBy",
        header: "Invited by",
        cell: ({ row }) => row.original.invitedByName ?? <span className="text-faint">—</span>,
      }),

      helper.accessor((p) => p.createdAt, {
        id: "joined",
        header: "Added",
        cell: ({ getValue }) => <span className="text-10">{new Date(getValue()).toLocaleDateString("en-GB")}</span>,
      }) as ColumnDef<typeof features, PersonDto, unknown>,

      helper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <div className="flex items-center gap-6 justify-end">
              {p.status !== "DISABLED" && p.status === "INVITED" && <Button onClick={() => onResendInvite(p)}>Resend invite</Button>}
              {isAdmin && (
                <Button variant="primary" onClick={() => onManage(p)}>
                  Manage
                </Button>
              )}
            </div>
          );
        },
      }),
    ];
    return cols;
  }, [isAdmin, onManage, onResendInvite]);

  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (p) => p.id,
    state: { sorting },
    onSortingChange: (u) => onSortingChange(typeof u === "function" ? u(sorting) : u),
  });

  const modelRows = table.getRowModel().rows;
  const SORTABLE = new Set(["name", "email", "unit", "joined"]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[720px]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border">
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  onClick={SORTABLE.has(h.column.id) ? h.column.getToggleSortingHandler() : undefined}
                  className={`text-9.5 uppercase tracking-label text-faint font-semibold px-12 py-7 text-left ${SORTABLE.has(h.column.id) ? "cursor-pointer select-none hover:text-dim" : ""}`}
                >
                  {h.isPlaceholder ? null : (
                    <span className="inline-flex items-center gap-3">
                      <table.FlexRender header={h} />
                      {h.column.getIsSorted() === "asc" && "↑"}
                      {h.column.getIsSorted() === "desc" && "↓"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {modelRows.map((row) => (
            <tr key={row.id} className="border-b border-border">
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className="px-12 py-7 text-11.5 align-top">
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
          {modelRows.length === 0 && (
            <tr>
              <td colSpan={8} className="text-center text-11.5 text-faint py-20">
                No one matches the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
