import type { CategoryDto, ItemDetailDto, ItemRowDto } from "@/lib/shared";
import { api } from "@/lib/api";

/**
 * Typed calls over the shared fetch wrapper (lib/api.ts) — one place the resource
 * pages import from, so a future filter/pagination change (Phase 6) touches this file
 * and not every call site.
 */
export const resourcesApi = {
  listCategories: () => api.get<CategoryDto[]>("/resources/categories"),
  /** Scoped, unpaginated for now — see the resource-register plan's Phase 6. */
  search: (params?: { categoryId?: string }) => {
    const qs = params?.categoryId ? `?categoryId=${encodeURIComponent(params.categoryId)}` : "";
    return api.get<ItemRowDto[]>(`/resources/search${qs}`);
  },
  getItem: (id: string) => api.get<ItemDetailDto>(`/resources/items/${id}`),
};
