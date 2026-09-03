"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { useDocRights } from "@/components/AccessProvider";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

export default function CloseClient({ closedThrough }: { closedThrough: string | null }) {
  const rights = useDocRights("year_close");
  const router = useRouter();
  const supabase = createClient();
  const [fyEnd, setFyEnd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!fyEnd) return setErr("Choose the fiscal-year-end date");
    if (!confirm(`Run year-end close as of ${fyEnd}? This posts a closing entry into Retained Earnings and locks all postings on or before this date.`)) return;
    setErr(null); setMsg(null); setBusy(true);
    const { data, error } = await supabase.rpc("year_end_close", { p_company: COMPANY_ID, p_fy_end: fyEnd });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg(`Closed. Net ${Number((data as any).net_profit) >= 0 ? "profit" : "loss"} SAR ${money(Math.abs((data as any).net_profit))} moved to Retained Earnings (voucher ${(data as any).entry_no}).`);
    router.refresh();
  }

  return (
    <div className="max-w-lg space-y-4">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
      {closedThrough && <div className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">Books are currently closed through <b>{closedThrough}</b>.</div>}
      <div className="card space-y-3">
        <p className="text-sm text-slate-600">Year-end close zeroes every income and expense account into <b>Retained Earnings (9-03)</b> as of the chosen date, then locks the period so nothing can post on or before it. Balance-sheet balances carry forward automatically.</p>
        <div><label className="label">Fiscal year end</label><input type="date" className="input" value={fyEnd} onChange={(e) => setFyEnd(e.target.value)} /></div>
        <button onClick={run} disabled={busy || !rights.canAccess} title={rights.denied("access")} className="btn disabled:opacity-40">{busy ? "Closing…" : "Run year-end close"}</button>
        <p className="text-xs text-slate-400">Admin only. This is reversible only by posting adjusting entries in the new year.</p>
      </div>
    </div>
  );
}
