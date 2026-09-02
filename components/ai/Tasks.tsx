"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateStr, fmtTime12 } from "@/lib/format";

// What she has prepared and is waiting on — and what became of the things
// already decided. Read straight from ai_pending_actions under its own-row
// RLS, so this is a record of fact rather than a second copy of one.
//
// Confirming happens on the conversation card, where the full message text is
// visible. A list like this is the wrong place to approve a send from: you
// would be approving a summary.

interface Row {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  status: "pending" | "executed" | "cancelled" | "failed" | "expired";
  result: { message?: string; sent?: number; failed?: number } | null;
  error: string | null;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
}

const BADGE: Record<Row["status"], string> = {
  pending: "badge-warning",
  executed: "badge-success",
  cancelled: "badge-neutral",
  failed: "badge-danger",
  expired: "badge-neutral",
};

export default function Tasks() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data, error } = await sb
      .from("ai_pending_actions")
      .select("id, kind, title, summary, status, result, error, created_at, expires_at, decided_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) setError(error.message);
    else { setError(null); setRows((data ?? []) as unknown as Row[]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const waiting = rows.filter((r) => r.status === "pending" && new Date(r.expires_at) > new Date());

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <p className="text-xs text-slate-500">
          {waiting.length
            ? `${waiting.length} waiting on you. Confirm them on the conversation, where you can read the messages.`
            : "Work she has prepared, and what became of it."}
        </p>
        <button onClick={load} className="btn-ghost btn-sm" disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="m-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          Nothing prepared yet. Ask her to draft payment reminders and it will show up here.
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const stale = r.status === "pending" && new Date(r.expires_at) <= new Date();
          return (
            <li key={r.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{r.title}</p>
                  {r.summary && <p className="mt-0.5 text-xs text-slate-500">{r.summary}</p>}
                  {r.result?.message && (
                    <p className="mt-1 text-xs text-slate-600">{r.result.message}</p>
                  )}
                  {r.error && <p className="mt-1 text-xs text-danger-fg">{r.error}</p>}
                </div>
                <span className={`badge shrink-0 ${stale ? "badge-neutral" : BADGE[r.status]}`}>
                  {stale ? "expired" : r.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Prepared {dateStr(r.created_at)} {fmtTime12(r.created_at)}
                {r.decided_at ? ` · decided ${dateStr(r.decided_at)} ${fmtTime12(r.decided_at)}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
