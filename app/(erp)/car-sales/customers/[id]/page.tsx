import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import SectionHeader from "@/components/reports/SectionHeader";
import { dateStr } from "@/lib/format";
import { sar, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE } from "../../lib";
import CustomerReportClient from "./CustomerReportClient";

export const dynamic = "force-dynamic";

function Money({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className={`text-lg font-bold tabular-nums ${tone ?? ""}`}>{value}</div></div>;
}

const money = (n: number) => n ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "0.00";

// The Customer Report — car_customer_report() (migration 438) carries
// everything ledger-true: the account balance, the ageing buckets (the same
// due/overdue/1-30/30+ shape ar_ap_aging already uses, so this page and that
// report never disagree on what "due" means), a billed/receipts/balance KPI
// per invoice type, and every bill this account has raised with what has
// been adjusted against it. The interactive half (Invoice Type filter, the
// bill-by-bill drill-down into its own voucher, the monthwise chart) is
// CustomerReportClient; everything static (profile, cars, ageing summary)
// stays server-rendered here.
//
// One thing the old software's equivalent report carried that has no home
// here: a "Violation Charges" column. VISTAERP has no violation-charge
// table or feature under Car Sales (only car_service_charges / its
// payments) — inventing a column with no data behind it is exactly what
// this codebase's own rule against fabricated figures warns against, so it
// is left out rather than faked. If Violation Charges is wanted, it needs
// its own feature (a table, a posting path) before it can show here.
export default async function CustomerProfile({ params }: { params: { id: string } }) {
  await guardStaffPage(["carsales.view", "carsales.installments", "carsales.sales"]);
  const supabase = createClient();

  const [{ data: report, error }, { data: receipts }] = await Promise.all([
    supabase.rpc("car_customer_report", { p_customer_id: params.id }),
    supabase.from("car_receipts").select("receipt_no, receipt_date, amount, contract:contract_id(contract_no)").eq("customer_id", params.id).order("receipt_date", { ascending: false }).limit(50),
  ]);
  if (error || !report || !(report as any).profile) notFound();

  const r: any = report;
  const cust = r.profile;
  const cars: any[] = r.cars ?? [];
  const ageing = r.ageing ?? {};
  const byType: any[] = r.by_type ?? [];
  const bills: any[] = r.bills ?? [];
  const monthwise: any[] = r.monthwise ?? [];
  const ledgerBalance = Number(r.ledger_balance ?? 0);

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title={cust.name} subtitle={[cust.phone, cust.email].filter(Boolean).join(" · ") || undefined} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Customer</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-400">Iqama / ID</dt><dd className="font-medium">{cust.iqama_no ?? cust.tax_number ?? "—"}</dd>
            <dt className="text-slate-400">Mobile</dt><dd className="font-medium">{cust.phone ?? "—"}</dd>
            <dt className="text-slate-400">Email</dt><dd className="font-medium">{cust.email ?? "—"}</dd>
            <dt className="text-slate-400">Address</dt><dd className="font-medium">{cust.address ?? "—"}</dd>
            <dt className="text-slate-400">Credit Days</dt><dd className="font-medium">{cust.credit_days ?? 0}</dd>
          </dl>
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Ledger Balance</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Money label="Ledger Balance" value={`${money(Math.abs(ledgerBalance))} ${ledgerBalance >= 0 ? "Dr" : "Cr"}`} tone={ledgerBalance > 0 ? "text-red-600" : "text-emerald-700"} />
            <Money label="Cars" value={String(cars.length)} />
          </div>
        </section>
      </div>

      <section>
        <SectionHeader title="Ageing Analysis" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-3 py-2 text-right"><span className="col-resize">Due</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Overdue</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">30 Days</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">30+ Days</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Total</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-2 text-right tabular-nums text-amber-700">{money(Number(ageing.due ?? 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums text-red-600">{money(Number(ageing.overdue ?? 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(Number(ageing.d30 ?? 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(Number(ageing.d30plus ?? 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{money(Number(ageing.due ?? 0) + Number(ageing.overdue ?? 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionHeader title="Cars" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full min-w-[720px] text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-3 py-2 text-left"><span className="col-resize">Contract</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Vehicle</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Date</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Value</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Status</span></th>
              </tr>
            </thead>
            <tbody>
              {cars.map((c, i) => (
                <tr key={c.id} className={i % 2 === 1 ? "bg-slate-100/80" : ""}>
                  <td className="px-3 py-2"><Link href={`/car-sales/contracts/${c.id}`} className="text-brand hover:underline">{c.contract_no}</Link></td>
                  <td className="px-3 py-2">{c.vehicle || c.plate_no || "—"}</td>
                  <td className="px-3 py-2">{dateStr(c.contract_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sar(c.net_payable)}</td>
                  <td className="px-3 py-2"><span className={`badge ${CONTRACT_STATUS_TONE[c.status] ?? "bg-slate-100"}`}>{CONTRACT_STATUS_LABEL[c.status] ?? c.status}</span></td>
                </tr>
              ))}
              {cars.length === 0 && <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={5}>No cars.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <CustomerReportClient byType={byType} bills={bills} monthwise={monthwise} />

      <section>
        <SectionHeader title="Recent Receipts" />
        <div className="card overflow-x-auto p-0">
          <table className="report-grid w-full min-w-[560px] text-sm">
            <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
              <tr>
                <th className="px-3 py-2 text-left"><span className="col-resize">Receipt</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Date</span></th>
                <th className="px-3 py-2 text-left"><span className="col-resize">Contract</span></th>
                <th className="px-3 py-2 text-right"><span className="col-resize">Amount</span></th>
              </tr>
            </thead>
            <tbody>
              {(receipts ?? []).map((rc: any, i: number) => (
                <tr key={rc.receipt_no} className={i % 2 === 1 ? "bg-slate-100/80" : ""}>
                  <td className="px-3 py-2">{rc.receipt_no}</td>
                  <td className="px-3 py-2">{dateStr(rc.receipt_date)}</td>
                  <td className="px-3 py-2">{rc.contract?.contract_no ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{sar(rc.amount)}</td>
                </tr>
              ))}
              {(receipts ?? []).length === 0 && <tr><td className="px-3 py-8 text-center text-slate-400" colSpan={4}>No receipts.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
