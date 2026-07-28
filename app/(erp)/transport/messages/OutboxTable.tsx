"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Msg { id: string; channel: string; to_addr: string | null; body: string | null; status: string; created_at: string; sent_at: string | null }
const COLOR: Record<string, string> = { queued: "bg-amber-100 text-amber-700", sent: "bg-green-100 text-green-700", failed: "bg-red-100 text-red-700" };

export default function OutboxTable({ initial }: { initial: Msg[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState("");

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function mark(id: string, s: string) {
    await supabase.from("transport_outbox").update({ status: s, sent_at: s === "sent" ? new Date().toISOString() : null }).eq("id", id);
    router.refresh();
  }
  async function del(id: string) { await supabase.from("transport_outbox").delete().eq("id", id); router.refresh(); }

  async function apiSend(body: any) {
    setBusy(true); setNote(null);
    const res = await fetch("/api/transport/whatsapp/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setNote(json.error || "Send failed"); return; }
    setNote(`Sent ${json.sent}, failed ${json.failed}.`);
    router.refresh();
  }

  const rows = status ? initial.filter((m) => m.status === status) : initial;
  const queuedWa = initial.filter((m) => m.status === "queued" && m.channel === "whatsapp").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[10rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="failed">Failed</option>
        </select>
        <button onClick={() => apiSend({ action: "send_queued" })} disabled={busy || queuedWa === 0} className="btn text-sm">
          {busy ? "Sending…" : `Send all queued WhatsApp (${queuedWa})`}
        </button>
        {note && <span className="text-sm text-slate-600">{note}</span>}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Channel</th><th className="th">To</th><th className="th">Message</th><th className="th">Status</th><th className="th">Actions</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-t border-slate-100 align-top">
                <td className="td whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                <td className="td capitalize">{m.channel}</td>
                <td className="td">{m.to_addr ?? "—"}</td>
                <td className="td max-w-sm whitespace-pre-wrap text-left text-xs text-slate-600">{m.body}</td>
                <td className="td"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[m.status] ?? "bg-slate-200"}`}>{m.status}</span></td>
                <td className="td whitespace-nowrap">
                  {m.status !== "sent" && m.channel === "whatsapp" && <button onClick={() => apiSend({ id: m.id })} disabled={busy} className="text-sm font-medium text-brand hover:underline">Send now</button>}
                  {m.status !== "sent" && <button onClick={() => mark(m.id, "sent")} className="ml-2 text-sm text-green-700 hover:underline">Mark sent</button>}
                  <button onClick={() => del(m.id)} className="ml-2 text-sm text-slate-400 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No messages.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
