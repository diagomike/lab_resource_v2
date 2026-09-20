import type { PublicCatalogDto } from "@/lib/shared";
import { api } from "./api";

/** F-057: the portal home and the request form both need the same public catalog; without a
 *  shared cache each page load (and each visit to the other page) fetched it again. One
 *  in-flight/finished promise is reused for a minute, and dropped on failure so a retry works. */
const TTL_MS = 60_000;
let cached: { at: number; promise: Promise<PublicCatalogDto> } | null = null;

export function loadPublicCatalog(): Promise<PublicCatalogDto> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.promise;
  const promise = api.get<PublicCatalogDto>("/public/catalog");
  cached = { at: Date.now(), promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = null;
  });
  return promise;
}
