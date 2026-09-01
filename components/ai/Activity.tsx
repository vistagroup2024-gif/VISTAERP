"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateStr, fmtTime12 } from "@/lib/format";

// Everything Vista AI has done, from the ERP's own audit trail — not from a
// log she keeps about herself. Rows are written by ai_log_action (a definer
// function) at the moment each tool runs, so a call that failed or was refused
// on permissions is here too. Reads under the existing audit_log RLS: staff,
// own company.

interface Row {
  id: string;
  created_at: string;
  action: string;
  detail: {
    tool?: string;
    args?: Record<string, unknown>;
    ok?: boolean;
    count?: number | null;
    error?: string | null;
    denied?: boolean;
  } | null;
  profiles?: { full_name: string | null; email: string | null } | null;
}

export default function Activity() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sb = createClient();
    const { data, error } = await sb
      .from("audit_log")
      .select("id, created_at, action, detail, profiles:user_id(full_name, email)")
      .eq("entity", "ai_action")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) setError(error.message);
    else { setError(null); setRows((data ?? []) as unknown as Row[]); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <p className="text-xs text-slate-500">
          Every ERP lookup and action Vista AI has made, from the audit trail.
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
        <p className="px-4 py-8 text-center text-sm text-slate-400">Nothing yet.</p>
      )}

      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => {
            const d = r.detail ?? {};
            const failed = d.ok === false;
            return (
              <tr key={r.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">
                  {dateStr(r.created_at)} {fmtTime12(r.created_at)}
                </td>
                <td className="px-2 py-2">
                  <span className={`badge ${r.action === "ai_write" ? "badge-warning" : "badge-neutral"}`}>
                    {r.action === "ai_write" ? "action" : "read"}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <div className="font-medium text-slate-700">{(d.tool ?? "—").replace(/_/g, " ")}</div>
                  {d.args && Object.keys(d.args).length > 0 && (
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {Object.entries(d.args).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}
                    </div>
                  )}
                  {failed && (
                    <div className="mt-0.5 text-xs text-danger-fg">
                      {d.denied ? "Refused — no permission" : d.error || "Failed"}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right text-xs text-slate-500">
                  {d.count != null ? `${d.count} row${d.count === 1 ? "" : "s"}` : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-slate-500">
                  {r.profiles?.full_name ?? r.profiles?.email ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
