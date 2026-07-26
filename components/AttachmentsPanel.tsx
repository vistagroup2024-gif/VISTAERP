"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface FileMeta { id: string; name: string; mime: string | null; size: number | null; source: string | null; created_at: string; }

const ACCEPT = ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf";
const MAX_BYTES = 5 * 1024 * 1024;

// Attachments for a Visa Group (JPG / PNG / PDF, multiple). Stored via RPC.
// `canEdit` allows upload/delete; when false the panel is view/download only.
export default function AttachmentsPanel({
  endpoint, groupId, canEdit,
}: { endpoint: string; groupId: string; canEdit: boolean }) {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const post = useCallback(async (body: any) => {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed");
    return json;
  }, [endpoint]);

  const load = useCallback(async () => {
    try { const j = await post({ action: "list", group: groupId }); setFiles(j.files ?? []); }
    catch (e: any) { setErr(e.message); }
  }, [post, groupId]);

  useEffect(() => { load(); }, [load]);

  function toBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (!list.length) return;
    setBusy(true); setErr(null);
    try {
      for (const file of list) {
        if (file.size > MAX_BYTES) { setErr(`${file.name} is larger than 5 MB.`); continue; }
        const data = await toBase64(file);
        await post({ action: "add", group: groupId, name: file.name, mime: file.type, size: file.size, data });
      }
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function open(id: string, download: boolean) {
    setErr(null);
    try {
      const j = await post({ action: "get", id });
      const f = j.file;
      const url = `data:${f.mime || "application/octet-stream"};base64,${f.data}`;
      if (download) {
        const a = document.createElement("a");
        a.href = url; a.download = f.name; a.click();
      } else {
        const w = window.open();
        if (w) w.document.write(`<title>${f.name}</title><body style="margin:0">${
          (f.mime || "").startsWith("image/") ? `<img src="${url}" style="max-width:100%"/>` : `<iframe src="${url}" style="border:0;width:100%;height:100vh"></iframe>`
        }</body>`);
      }
    } catch (e: any) { setErr(e.message); }
  }

  async function del(id: string) {
    if (!confirm("Delete this attachment?")) return;
    setBusy(true); setErr(null);
    try { await post({ action: "delete", id }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-700">📎 Attachments</h2>
          <p className="text-xs text-slate-500">JPG, PNG or PDF · up to 5 MB each · multiple files allowed.</p>
        </div>
        {canEdit && (
          <>
            <input ref={inputRef} type="file" multiple accept={ACCEPT} onChange={onPick} className="hidden" />
            <button type="button" className="btn-outline text-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
              {busy ? "Uploading…" : "+ Upload files"}
            </button>
          </>
        )}
      </div>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {files.length === 0 ? (
        <p className="text-sm text-slate-400">No attachments yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {(f.mime || "").includes("pdf") ? "📄" : "🖼"} {f.name}
                <span className="ml-2 text-xs text-slate-400">{f.size ? `${Math.round(f.size / 1024)} KB` : ""}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <button type="button" onClick={() => open(f.id, false)} className="text-brand hover:underline">View</button>
                <button type="button" onClick={() => open(f.id, true)} className="text-slate-500 hover:underline">Download</button>
                {canEdit && <button type="button" onClick={() => del(f.id)} className="text-red-600 hover:underline">Delete</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
