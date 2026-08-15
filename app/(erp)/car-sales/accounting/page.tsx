import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { sar } from "../lib";
import SyncButton from "./SyncButton";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  car_purchase: "Vehicle Purchases", car_sale: "Vehicle Sales", car_advance: "Advances",
  car_receipt: "Installment Receipts", car_scharge: "Service Charge Accruals",
  car_scharge_pay: "Service Charge Payments", car_commission: "Commissions",
};

export default async function CarAccountingPage() {
  await guardStaffPage("carsales.accounting");
  const supabase = createClient();

  // Aggregate posted car journal entries by source (debit totals per entry group).
  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id, source, journal_lines(debit)")
    .like("source", "car_%")
    .limit(20000);

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

      <section className="card space-y-3">
        <h2 className="font-semibold text-slate-700">Post to the General Ledger</h2>
        <p className="text-sm text-slate-500">
          Posts every car-sales event as a balanced double-entry journal to your existing accounts, using dedicated car
          AR/AP accounts (Installment Receivable 1150, Vehicle Inventory 1160, Service Charge Receivable 1170, Vehicle
          Supplier Payable 2100, Commission Payable 2110, Vehicle Sales 4200, Monthly Service Charges 4300, Cost of
          Vehicles Sold 5100, Sales Commission 6300). It is idempotent — already-posted events are skipped, so you can
          run it any time.
        </p>
        <SyncButton />
      </section>

      <section className="card overflow-x-auto p-0">
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="font-semibold text-slate-700">Posted Journals</h2>
          <Link href="/accounting/journal" className="text-sm text-brand hover:underline">Open General Journal →</Link>
        </div>
        <table className="mt-2 w-full">
          <thead className="bg-slate-50"><tr><th className="th">Type</th><th className="th text-right">Entries</th><th className="th text-right">Debit Total</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.source} className="border-t border-slate-100">
                <td className="td">{SOURCE_LABEL[r.source]}</td>
                <td className="td text-right">{r.count}</td>
                <td className="td text-right tabular-nums">{sar(r.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-slate-200 font-semibold"><td className="td">Total</td><td className="td text-right">{totalEntries}</td><td className="td"></td></tr></tfoot>
        </table>
      </section>
    </div>
  );
}
