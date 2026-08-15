import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import CarBarChart from "./CarBarChart";
import { sar, monthLabel } from "./lib";

export const dynamic = "force-dynamic";

function Card({ label, value, tone, href }: { label: string; value: string | number; tone?: string; href?: string }) {
  const inner = (
    <div className="card px-4 py-3 hover:shadow-md">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-slate-800"}`}>{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
    </div>
  );
}

export default async function CarSalesDashboard() {
  const access = await guardStaffPage(["carsales.view", "carsales.reports", "carsales.vehicles"]);
  const supabase = createClient();
  const canCost = staffCan(access, "carsales.cost");
  const today = new Date().toISOString().slice(0, 10);
  const ym = today.slice(0, 7);

  const [{ data: vehicles }, { data: contracts }, { data: charges }, { data: commissions }, { data: receipts }] = await Promise.all([
    supabase.from("car_vehicles").select("status, ownership, total_cost"),
    supabase.from("car_contracts").select("status, sale_price, advance, purchase_cost, contract_date, car_installments(amount, paid_amount, due_date)"),
    supabase.from("car_service_charges").select("amount, paid_amount, due_date, charge_month"),
    supabase.from("car_commissions").select("amount"),
    supabase.from("car_receipts").select("amount, receipt_date"),
  ]);

  const V = vehicles ?? [], C = (contracts ?? []) as any[], SC = charges ?? [], CM = commissions ?? [], RC = receipts ?? [];
  const vc = (s: string) => V.filter((v: any) => v.status === s).length;

  // Receivables from non-cancelled contracts
  const active = C.filter((c) => c.status !== "cancelled");
  let outstanding = 0, overdue = 0, dueThisMonth = 0;
  for (const c of active) {
    const insts = (c.car_installments ?? []) as any[];
    const paid = insts.reduce((a, i) => a + Number(i.paid_amount || 0), 0);
    outstanding += Number(c.sale_price || 0) - Number(c.advance || 0) - paid;
    for (const i of insts) {
      const rem = Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0));
      if (i.due_date && i.due_date < today) overdue += rem;
      if (i.due_date && String(i.due_date).slice(0, 7) === ym) dueThisMonth += rem;
    }
  }
  const collectedThisMonth = RC.filter((r: any) => String(r.receipt_date).slice(0, 7) === ym).reduce((a, r: any) => a + Number(r.amount || 0), 0);

  // Charges
  const scOutstanding = SC.reduce((a: number, c: any) => a + Math.max(0, Number(c.amount || 0) - Number(c.paid_amount || 0)), 0);
  const scOverdue = SC.filter((c: any) => c.due_date < today).reduce((a: number, c: any) => a + Math.max(0, Number(c.amount || 0) - Number(c.paid_amount || 0)), 0);
  const scThisMonth = SC.filter((c: any) => String(c.charge_month).slice(0, 7) === ym).reduce((a: number, c: any) => a + Number(c.amount || 0), 0);

  // Profit
  const purchaseCost = C.filter((c) => c.status !== "cancelled").reduce((a, c) => a + Number(c.purchase_cost || 0), 0);
  const salesValue = C.filter((c) => c.status !== "cancelled").reduce((a, c) => a + Number(c.sale_price || 0), 0);
  const advances = C.filter((c) => c.status !== "cancelled").reduce((a, c) => a + Number(c.advance || 0), 0);
  const commissionTotal = CM.reduce((a: number, r: any) => a + Number(r.amount || 0), 0);
  const grossProfit = salesValue - purchaseCost;

  // Monthly chart (last 6 months): sales value (contract_date) vs collections (receipt_date)
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const chart = months.map((m) => ({
    label: monthLabel(m + "-01"),
    a: C.filter((c) => String(c.contract_date).slice(0, 7) === m).reduce((s, c) => s + Number(c.sale_price || 0), 0),
    b: RC.filter((r: any) => String(r.receipt_date).slice(0, 7) === m).reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Car Sales Dashboard" />

      <Section title="Sales">
        <Card label="Contracts" value={C.length} href="/car-sales/contracts" />
        <Card label="Active" value={C.filter((c) => c.status === "active").length} tone="text-blue-700" />
        <Card label="Completed" value={C.filter((c) => c.status === "completed").length} tone="text-emerald-700" />
        <Card label="Sales Value" value={sar(salesValue)} />
        <Card label="Advance Collected" value={sar(advances)} />
        <Card label="Collected (Month)" value={sar(collectedThisMonth)} tone="text-emerald-700" />
      </Section>

      <Section title="Inventory">
        <Card label="Vehicles" value={V.length} href="/car-sales/vehicles" />
        <Card label="In Stock" value={vc("in_stock")} tone="text-emerald-700" />
        <Card label="Reserved" value={vc("reserved")} tone="text-amber-700" />
        <Card label="Sold" value={vc("sold")} tone="text-blue-700" />
        <Card label="Delivered" value={vc("delivered")} tone="text-indigo-700" />
        <Card label="Held by Vista" value={vc("held")} tone="text-red-600" />
      </Section>

      <Section title="Receivables">
        <Card label="Outstanding" value={sar(outstanding)} href="/car-sales/reports/outstanding" />
        <Card label="Overdue" value={sar(overdue)} tone="text-red-600" href="/car-sales/reports/aging" />
        <Card label="Due This Month" value={sar(dueThisMonth)} tone="text-amber-700" />
        <Card label="Collected (Month)" value={sar(collectedThisMonth)} tone="text-emerald-700" />
        <Card label="Transferred" value={V.filter((v: any) => v.ownership === "transferred").length} />
        <Card label="Vista-owned" value={V.filter((v: any) => v.ownership === "vista").length} />
      </Section>

      <Section title="Monthly Service Charges">
        <Card label="This Month" value={sar(scThisMonth)} href="/car-sales/service-charges" />
        <Card label="Outstanding" value={sar(scOutstanding)} />
        <Card label="Overdue" value={sar(scOverdue)} tone="text-red-600" />
        <Card label="Vehicles (Vista)" value={V.filter((v: any) => v.ownership === "vista").length} />
      </Section>

      {canCost && (
        <Section title="Profitability">
          <Card label="Purchase Cost" value={sar(purchaseCost)} />
          <Card label="Sales Value" value={sar(salesValue)} />
          <Card label="Gross Profit" value={sar(grossProfit)} tone="text-emerald-700" />
          <Card label="Commission" value={sar(commissionTotal)} tone="text-amber-700" />
          <Card label="Net Profit" value={sar(grossProfit - commissionTotal)} tone="text-emerald-700" />
        </Section>
      )}

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Sales vs Collections (6 months)</h2>
        <CarBarChart data={chart} series={{ a: "Sales", b: "Collections" }} />
      </div>
    </div>
  );
}
