import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import SectionHeader from "@/components/reports/SectionHeader";
import { sar } from "../lib";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  car_purchase: "Vehicle Purchases", car_sale: "Vehicle Sales", car_advance: "Advances",
  car_receipt: "Installment Receipts", car_scharge: "Service Charge Accruals",
  car_scharge_pay: "Service Charge Payments", car_commission: "Commissions",
};

export default async function CarAccountingPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  await guardStaffPage("carsales.accounting");
  const supabase = createClient();
  const from = searchParams.from || "";
  const to = searchParams.to || "";

  // Aggregate posted car journal entries by source (debit totals per entry group).
  let query = supabase
    .from("journal_entries")
    .select("id, source, entry_date, journal_lines(debit)")
    .like("source", "car_%")
    .limit(20000);
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);
  const { data: entries } = await query;

  const agg = new Map<string, { count: number; total: number }>();
  for (const e of (entries ?? []) as any[]) {
    const cur = agg.get(e.source) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += (e.journal_lines ?? []).reduce((a: number, l: any) => a + Number(l.debit || 0), 0);
    agg.set(e.source, cur);
  }
  const rows = Object.keys(SOURCE_LABEL).map((s) => ({ source: s, ...(agg.get(s) ?? { count: 0, total: 0 }) }));
  const totalEntries = rows.reduce((a, r) => a + r.count, 0);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Car Sales — Accounting" />

      <form className="card flex flex-wrap items-end gap-3 print:hidden" method="get">
        <div><label className="label">Entry Date From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">Entry Date To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
        {(from || to) && <a href="/car-sales/accounting" className="text-sm text-slate-400 hover:underline">Clear</a>}
      </form>

      <section className="card space-y-2">
        <SectionHeader title="Posted automatically" />
        <p className="text-sm text-slate-500">
          Every car-sales event posts its own balanced double entry the moment it happens — nothing to run by hand.
          It uses the dedicated car accounts: Installment Receivable 1150, Vehicle Inventory 1160, Service Charge
          Receivable 1170, Vehicle Supplier Payable 2100, Commission Payable 2110, Vehicle Sales 4200, Monthly Service
          Charges 4300, Cost of Vehicles Sold 5100 and Sales Commission 6300.
        </p>
        <p className="text-sm text-slate-500">
          A car bought on a Purchase Voucher is posted by that voucher — it debits Vehicle Inventory 1160 and credits
          the supplier — so the purchase is never booked twice.
        </p>
      </section>

      <section className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <SectionHeader title="Posted Journals" />
          <Link href="/accounting/journal" className="text-sm text-brand hover:underline">Open General Journal →</Link>
        </div>
        <table className="report-grid mt-2 w-full">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800"><tr><th className="px-4 py-2.5 text-left"><span className="col-resize">Type</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Entries</span></th><th className="px-4 py-2.5 text-right"><span className="col-resize">Debit Total</span></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.source} className={`border-t border-slate-100 ${i % 2 === 1 ? "bg-slate-100/80" : ""}`}>
                <td className="td">{SOURCE_LABEL[r.source]}</td>
                <td className="td text-right">{r.count}</td>
                <td className="td text-right tabular-nums">{sar(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-400 bg-slate-200 font-bold"><td className="td">Total</td><td className="td text-right">{totalEntries}</td><td className="td"></td></tr></tfoot>
        </table>
      </section>
    </div>
  );
}
