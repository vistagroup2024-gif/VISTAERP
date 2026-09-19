import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateTimeStr } from "@/lib/format";
import AuditFilters from "./AuditFilters";

export const dynamic = "force-dynamic";

const ACTION_BADGE: Record<string, string> = {
  posted: "bg-green-100 text-green-700", submitted: "bg-amber-100 text-amber-700",
  authorized: "bg-green-100 text-green-700", approval: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700", cancelled: "bg-slate-200 text-slate-600",
};

// From/To narrows the window (nested, not combinable — single date-range
// control); Action is an independent, additive criterion, so it's the
// multi-select toggle in AuditFilters. Both are query-string driven, the same
// as Transactions Report's own filter bar, so the table can never disagree
// with what the filters say is selected.
export default async function AuditPage({ searchParams }: { searchParams: { from?: string; to?: string; action?: string } }) {
  const sb = createClient();
  const from = searchParams.from || "";
  const to = searchParams.to || "";
  const actions = searchParams.action ? searchParams.action.split(",").filter(Boolean) : [];

  let q = sb.from("acct_audit")
    .select("action, doc_type, ref, detail, at, profiles(full_name, email)")
    .order("at", { ascending: false }).limit(300);
  if (from) q = q.gte("at", `${from}T00:00:00`);
  if (to) {
    // Wall-clock date arithmetic stays UTC-anchored per lib/saudiTime.ts's own
    // convention (it never asks what time it is) — the "to" day runs through
    // 23:59:59, so a filter ending today still includes today's activity.
    const next = new Date(`${to}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    q = q.lt("at", next.toISOString().slice(0, 10) + "T00:00:00");
  }
  if (actions.length) q = q.in("action", actions);

  const { data } = await q;
  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-4">
      <PageHeader title="Audit Trail" />
      <AuditFilters from={from} to={to} action={actions} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-left">Document</th><th className="px-3 py-2 text-left">Ref</th><th className="px-3 py-2 text-left">By</th><th className="px-3 py-2 text-left">Detail</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{dateTimeStr(r.at)}</td>
                <td className="px-3 py-1.5"><span className={`badge ${ACTION_BADGE[r.action] ?? "bg-slate-100 text-slate-600"}`}>{r.action}</span></td>
                <td className="px-3 py-1.5">{r.doc_type}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.ref}</td>
                <td className="px-3 py-1.5">{r.profiles?.full_name ?? r.profiles?.email ?? "—"}</td>
                <td className="px-3 py-1.5 text-xs text-slate-500">{r.detail ? JSON.stringify(r.detail) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={6}>No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
