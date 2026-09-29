"use client";

import { useEffect, useRef, useState } from "react";
import { FileImage, FileSpreadsheet, FileText, LoaderCircle, Paperclip, X } from "lucide-react";
import { ATTACHMENT_ACCEPT, ATTACHMENT_LIMITS, type PurchaseAttachmentDto, type PurchaseRequestDto } from "@/lib/shared";
import { api, ApiError } from "@/lib/api";

/**
 * Documents on a purchase request: the picker a head, an approver or procurement uses
 * to send minutes, stamped letters or a spreadsheet with an action, and the list that
 * shows what a request carries.
 *
 * Size is handled before anything leaves the browser: a photo or scan is shrunk to at
 * most DOCUMENT_MAX_EDGE px and re-saved as JPEG (a phone photo of a letter drops from
 * 3–5 MB to a few hundred KB), and a file still over the limit is refused here with a
 * way to fix it, not sent to be refused by the server. Each file is uploaded as soon as
 * it is chosen and held unsent (STAGED) until the action goes. Removing it, or
 * cancelling the form (`discardAttachments`), deletes it again; anything left behind by
 * a closed tab is swept by the server after 12 hours.
 */

const DOCUMENT_MAX_EDGE = 2200; // matches the server's normalizeDocumentImage
const JPEG_QUALITY = 0.8;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(file: File): boolean {
  return /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

/** A photo or scan, shrunk and re-saved as JPEG in the browser. Anything that can't be
 *  decoded here goes up as it is (the server re-encodes images anyway). */
async function shrinkImage(file: File): Promise<Blob> {
  if (typeof createImageBitmap === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, DOCUMENT_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 700_000) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.fillStyle = "#ffffff"; // a transparent PNG scan must not turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function tooBigMessage(file: File, size: number): string {
  const limit = formatBytes(ATTACHMENT_LIMITS.fileBytes);
  if (isImage(file)) return `${file.name} is still ${formatBytes(size)} after shrinking — the limit is ${limit}. Save it as a JPEG and try again.`;
  return `${file.name} is ${formatBytes(size)} — the limit is ${limit} a file. Scan at 150–200 dpi (grayscale for plain text), or split it into parts.`;
}

type Uploading = { key: string; name: string; error?: string };

/** Deletes files that were uploaded for a form the person then cancelled. */
export function discardAttachments(files: PurchaseAttachmentDto[]) {
  for (const f of files) void api.delete(`/resources/purchase-attachments/${encodeURIComponent(f.id)}`).catch(() => undefined);
}

export function AttachmentPicker({
  value,
  onChange,
  disabled,
  label = "Attach documents",
  hint,
  onBusyChange,
}: {
  value: PurchaseAttachmentDto[];
  onChange: (next: PurchaseAttachmentDto[]) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /** True while a chosen file is still on its way up — the action's button waits for it. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [uploading, setUploading] = useState<Uploading[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;

  const busy = uploading.some((u) => !u.error);
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  const room = ATTACHMENT_LIMITS.perAction - value.length - uploading.filter((u) => !u.error).length;

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    const accepted = chosen.slice(0, Math.max(0, room));
    const skipped = chosen.length - accepted.length;
    const errors: Uploading[] = skipped
      ? [{ key: `limit-${Date.now()}`, name: `${skipped} file${skipped === 1 ? "" : "s"}`, error: `At most ${ATTACHMENT_LIMITS.perAction} files go with one action.` }]
      : [];
    setUploading((prev) => [...prev.filter((u) => !u.error), ...errors]);

    let next = latest.current;
    for (const file of accepted) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploading((prev) => [...prev, { key, name: file.name }]);
      try {
        const blob = isImage(file) ? await shrinkImage(file) : file;
        if (blob.size > ATTACHMENT_LIMITS.fileBytes) throw new Error(tooBigMessage(file, blob.size));
        const dto = await api.postFile<PurchaseAttachmentDto>(`/resources/purchase-attachments?name=${encodeURIComponent(file.name)}`, blob);
        next = [...next, dto];
        onChange(next);
        setUploading((prev) => prev.filter((u) => u.key !== key));
      } catch (e) {
        const message = e instanceof ApiError || e instanceof Error ? e.message : `${file.name} could not be uploaded.`;
        setUploading((prev) => prev.map((u) => (u.key === key ? { ...u, error: message } : u)));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(id: string) {
    discardAttachments(latest.current.filter((f) => f.id === id));
    onChange(latest.current.filter((f) => f.id !== id));
  }

  const total = value.reduce((n, f) => n + f.byteSize, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-8">
        <button
          type="button"
          className="inline-flex items-center gap-4 h-24 px-8 rounded-2 border border-dashed border-border2 text-10.5 text-dim hover:text-text hover:border-accent disabled:opacity-45"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || room <= 0}
        >
          <Paperclip size={12} aria-hidden /> {label}
        </button>
        <span className="text-9.5 text-faint">
          {hint ?? "PDF, photo or scan, or .xlsx"} · up to {formatBytes(ATTACHMENT_LIMITS.fileBytes)} each, {ATTACHMENT_LIMITS.perAction} per action
          {value.length ? ` · ${value.length} ready (${formatBytes(total)})` : ""}
        </span>
        <input ref={inputRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="hidden" onChange={(e) => void add(e.target.files)} />
      </div>

      {(value.length > 0 || uploading.length > 0) && (
        <ul className="flex flex-col gap-3">
          {value.map((f) => (
            <li key={f.id} className="flex items-center gap-6 text-10.5">
              <FileChip file={f} />
              <button type="button" className="text-faint hover:text-bad" onClick={() => remove(f.id)} disabled={disabled} aria-label={`Remove ${f.fileName}`}>
                <X size={12} />
              </button>
            </li>
          ))}
          {uploading.map((u) => (
            <li key={u.key} className={`flex items-center gap-6 text-10.5 ${u.error ? "text-bad" : "text-dim"}`}>
              {u.error ? (
                <>
                  <span className="flex-1">{u.error}</span>
                  <button type="button" className="text-faint hover:text-text" onClick={() => setUploading((prev) => prev.filter((x) => x.key !== u.key))} aria-label="Dismiss">
                    <X size={12} />
                  </button>
                </>
              ) : (
                <>
                  <LoaderCircle size={12} className="animate-spin" aria-hidden /> Uploading {u.name}…
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KindIcon({ kind }: { kind: PurchaseAttachmentDto["kind"] }) {
  const Icon = kind === "PDF" ? FileText : kind === "IMAGE" ? FileImage : FileSpreadsheet;
  return <Icon size={12} className="shrink-0 text-faint" aria-hidden />;
}

export function FileChip({ file }: { file: PurchaseAttachmentDto }) {
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-4 min-w-0 text-accent hover:underline" title={`Open ${file.fileName}`}>
      <KindIcon kind={file.kind} />
      <span className="truncate max-w-[320px]">{file.fileName}</span>
      <span className="text-faint no-underline shrink-0">({formatBytes(file.byteSize)})</span>
    </a>
  );
}

type HistoryEntry = PurchaseRequestDto["history"][number];

function actionLabel(e: HistoryEntry): string {
  switch (e.stage) {
    case "REJECTED":
      return "rejecting it";
    case "REVISING":
      return "sending it back";
    case "CANCELLED":
      return "cancelling it";
    case "APPROVING":
      if (e.note?.startsWith("Approved")) return "approving";
      if (e.note?.startsWith("Revised")) return "resubmitting";
      return "submitting";
    default:
      return "";
  }
}

/** Every document on the request, each with who sent it and with which action — the
 *  approver sees the head's minutes and letters without opening the full history. */
export function RequestDocuments({ history }: { history: PurchaseRequestDto["history"] }) {
  const entries = history.filter((e) => e.attachments.length > 0);
  if (!entries.length) return null;
  const count = entries.reduce((n, e) => n + e.attachments.length, 0);
  return (
    <div className="flex flex-col gap-4">
      <span className="text-9.5 uppercase tracking-label text-faint">Documents ({count})</span>
      <ul className="flex flex-col gap-3">
        {entries.flatMap((e) =>
          e.attachments.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-6 text-10.5">
              <FileChip file={f} />
              <span className="text-faint">
                — {e.byName}
                {actionLabel(e) ? `, ${actionLabel(e)}` : ""} · {new Date(e.at).toLocaleDateString()}
              </span>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}
