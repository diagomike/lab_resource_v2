/**
 * Kept as a re-export so every existing `from "../../components/DataTable"` import keeps
 * working. The implementation moved to ./data-table/ when it grew a URL-state layer, a
 * filter builder and a pure operator matrix — see ./data-table/DataTable.tsx.
 */
export { DataTable } from "./data-table/DataTable";
export type { DataTableColumn } from "./data-table/types";

