"use client";

import type { ItemRowDto } from "@/lib/shared";
import type { DataTableColumn } from "@/components/data-table";
import { Tag } from "@/components/ui";
import { STATUS_LABEL, STATUS_TAG_TONE } from "./status";

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));

/**
 * The register's Phase 1 columns: name / category / status / owning unit / custodian.
 * Filtering/sorting run client-side over the already-scoped rows the API returned —
 * fine for now, and replaced by server-mode paging once the register is large enough
 * to matter (see the resource-register plan's Phase 6).
 */
export function buildItemColumns(): DataTableColumn<ItemRowDto>[] {
  return [
    {
      id: "name",
      header: "Name",
      cell: (r) => r.name,
      value: (r) => r.name,
      variant: "text",
      sortable: true,
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => r.categoryName,
      value: (r) => r.categoryName,
      variant: "multiSelect",
      sortable: true,
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => <Tag tone={STATUS_TAG_TONE[r.status]}>{STATUS_LABEL[r.status]}</Tag>,
      value: (r) => r.status,
      variant: "select",
      options: STATUS_OPTIONS,
      sortable: true,
    },
    {
      id: "owner",
      header: "Owning unit",
      cell: (r) => r.ownerOrgName,
      value: (r) => r.ownerOrgName,
      variant: "multiSelect",
      sortable: true,
    },
    {
      id: "custodian",
      header: "Custodian",
      cell: (r) => r.custodianName,
      value: (r) => r.custodianName,
      variant: "multiSelect",
      sortable: true,
    },
  ];
}
