// Same-origin now that the API and the frontend are one Next.js app — no more
// VITE_API_BASE/CORS bridge to configure. See the conversion plan §1.3.
const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: unknown,
    /** The whole parsed error body. Some endpoints answer with a STRUCTURED refusal rather
     *  than a plain message — catalog propose returns 409 with the near-duplicate matches it
     *  wants you to look at before re-posting with acknowledgedDuplicates. Keeping only
     *  `message` threw that payload away, so the duplicate check could not be surfaced. */
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include", // send/receive the httpOnly session cookie
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message ?? "Request failed", body.issues, body);
  }
  // A 204/205 never has a body by spec, and some endpoints (auth/logout among them) return
  // 201 with nothing at all — res.json() on an empty body throws a SyntaxError, which used
  // to surface as a silent, swallowed logout failure. Content-Length is the reliable
  // signal; falling back to content-type catches the rare case a proxy strips it.
  const noBody =
    res.status === 204 ||
    res.status === 205 ||
    res.headers.get("content-length") === "0" ||
    !res.headers.get("content-type")?.includes("application/json");
  if (noBody) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** For file downloads (letters, imports later) — the response body is a binary blob,
   *  not JSON, so this bypasses request()'s res.json() entirely. */
  async postBlob(path: string, body?: unknown): Promise<Blob> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, parsed.message ?? "Request failed", parsed.issues);
    }
    return res.blob();
  },
  /** Same as postBlob but for a GET — the report CSV/PDF exports take their filters as
   *  query params, not a body. */
  async getBlob(path: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}${path}`, { method: "GET", credentials: "include" });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, parsed.message ?? "Request failed", parsed.issues);
    }
    return res.blob();
  },
  /** The two-step image upload's step 2 — a raw PUT of file bytes (never JSON) to a
   *  server-issued `uploadUrl`. The declared Content-Type travels along as a hint
   *  only; the server never trusts it (lib/server/resources/image-sniff.ts sniffs the
   *  real bytes) and this call's caller must not either. */
  async putFile<T>(path: string, blob: Blob): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
    if (!res.ok) {
      const parsed = await res.json().catch(() => ({ message: res.statusText }));
      throw new ApiError(res.status, parsed.message ?? "Request failed", parsed.issues, parsed);
    }
    return res.json() as Promise<T>;
  },
};

/** Triggers a browser save-as for a blob fetched via getBlob/postBlob — object URLs are
 *  revoked immediately after the click since the download itself doesn't need them kept. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
