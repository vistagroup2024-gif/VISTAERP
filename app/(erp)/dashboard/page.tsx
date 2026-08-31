import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money, dateStr } from "@/lib/format";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import StatTile from "@/components/ui/StatTile";
import MiniBars from "@/components/ui/MiniBars";
import Icon from "@/components/ui/Icon";
import { getStaffAccess, staffCan, staffLanding, getSessionUser } from "@/lib/staffSession";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const compact = (n: number) =>
  Math.abs(n) >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : String(Math.round(n));

async function count(table: string) {
  const supabase = createClient();
  const { count } = await supabase.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function Dashboard() {
  const supabase = createClient();
  const user = await getSessionUser();

  const access = await getStaffAccess();
  if (!staffCan(access, "dashboard.view")) {
    const dest = staffLanding(access);
    if (dest !== "/dashboard") redirect(dest);
  }

  const { data: prof } = await supabase.from("profiles").select("company_id").eq("id", user!.id).maybeSingle();
  const noCompany = !(prof as any)?.company_id;

  const [groups, hotelsN, invoicesN] = await Promise.all([
    count("umrah_groups"), count("hotels"), count("invoices"),
  ]);

  // Real receivables / payables from the accounting open-items ledger.
  const today = new Date().toISOString().slice(0, 10);
  const { data: openItems } = await supabase
    .from("open_items")
    .select("direction, outstanding_base, due_date, status")
    .eq("status", "open");
  let ar = 0, ap = 0, overdue = 0;
  for (const r of openItems ?? []) {
    const amt = Number((r as any).outstanding_base) || 0;
    if ((r as any).direction === "D") { ar += amt; if ((r as any).due_date && (r as any).due_date < today) overdue += amt; }
    else if ((r as any).direction === "C") ap += amt;
  }

  // 6-month invoice trend (real, from created_at).
  const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1);
  const { data: trendRows } = await supabase
    .from("invoices").select("created_at").gte("created_at", since.toISOString());
  const buckets: { label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i); d.setDate(1);
    buckets.push({ label: MONTHS[d.getMonth()], value: 0 });
  }
  const base = new Date(); base.setMonth(base.getMonth() - 5);
  for (const r of trendRows ?? []) {
    const c = new Date((r as any).created_at);
    const idx = (c.getFullYear() - base.getFullYear()) * 12 + (c.getMonth() - base.getMonth());
    if (idx >= 0 && idx < 6) buckets[idx].value += 1;
  }

  const { data: recent } = await supabase
    .from("invoices")
    .select("id, invoice_no, status, total, currency, invoice_date")
    .order("created_at", { ascending: false }).limit(6);

  const statusBadge = (s: string) => {
    const v = (s || "").toLowerCase();
    if (["confirmed", "completed", "paid"].includes(v)) return "badge-success";
    if (["pending", "processing", "draft"].includes(v)) return "badge-warning";
    if (["cancelled", "rejected"].includes(v)) return "badge-danger";
    return "badge-neutral";
  };

  return (
    <div className="space-y-6">
      <RealtimeRefresh tables={["umrah_groups", "brn_inventory", "brn_consumption", "group_brn_allocation"]} />

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">Business at a glance · {dateStr(today)}</p>
        </div>
      </div>

      {noCompany && (
        <div className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-soft/50 px-4 py-3 text-sm text-warning-fg">
          <Icon name="bell" size={16} className="mt-0.5 shrink-0" />
          <span>Your account isn’t linked to a company yet, so data is hidden by row-level security. An admin must set your <code>company_id</code> in <code>profiles</code>.</span>
        </div>
      )}

      {/* Financial KPIs (real, from the accounting ledger) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Receivables" value={money(ar, "SAR")} hint="Open customer balances" icon="wallet" tone="brand" emphasis href="/accounting/aging" />
        <StatTile label="Payables" value={money(ap, "SAR")} hint="Open supplier balances" icon="receipt" tone="neutral" emphasis href="/accounting/aging" />
        <StatTile label="Overdue" value={money(overdue, "SAR")} hint="Receivables past due date" icon="clock" tone={overdue > 0 ? "warning" : "neutral"} emphasis href="/accounting/aging" />
        <StatTile label="Net Position" value={money(ar - ap, "SAR")} hint="Receivables − Payables" icon={ar - ap >= 0 ? "trendUp" : "trendDown"} tone={ar - ap >= 0 ? "success" : "danger"} emphasis />
      </div>

      {/* Operational counts */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Visa Groups" value={compact(groups)} icon="visa" tone="neutral" href="/groups" />
        <StatTile label="Hotels" value={compact(hotelsN)} icon="hotel" tone="neutral" href="/hotels" />
        <StatTile label="Invoices" value={compact(invoicesN)} icon="receipt" tone="neutral" href="/invoices" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Trend chart */}
        <div className="panel lg:col-span-2">
          <div className="panel-head">
            <h2 className="text-sm font-semibold text-slate-700">Invoices · last 6 months</h2>
            <Link href="/invoices" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              View all <Icon name="chevronRight" size={12} />
            </Link>
          </div>
          <div className="p-5">
            <MiniBars data={buckets} />
          </div>
        </div>

        {/* Recent invoices */}
        <div className="panel lg:col-span-1">
          <div className="panel-head">
            <h2 className="text-sm font-semibold text-slate-700">Recent invoices</h2>
            <Link href="/invoices" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              All <Icon name="chevronRight" size={12} />
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {(recent ?? []).map((b) => (
              <Link key={b.id} href={`/invoices/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-slate-50">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{b.invoice_no}</p>
                  <p className="text-xs text-slate-400">{b.invoice_date ? dateStr(b.invoice_date) : "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-slate-700">{money(b.total, b.currency || "SAR")}</span>
                  <span className={`badge ${statusBadge(b.status)} capitalize`}>{b.status}</span>
                </div>
              </Link>
            ))}
            {(recent ?? []).length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-slate-400">No invoices yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
