import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { sar, vehicleTitle } from "../lib";

export const dynamic = "force-dynamic";

interface Alert { tone: string; text: string; href: string; sub?: string }

function Group({ title, items, tone }: { title: string; items: Alert[]; tone: string }) {
  if (items.length === 0) return null;
  return (
    <section className="card">
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-slate-700">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`} />{title} <span className="text-sm font-normal text-slate-400">({items.length})</span>
      </h2>
      <ul className="divide-y divide-slate-100 text-sm">
        {items.map((a, i) => (
          <li key={i} className="py-2">
            <Link href={a.href} className="text-brand hover:underline">{a.text}</Link>
            {a.sub && <span className="text-slate-400"> · {a.sub}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function AlertsPage() {
  await guardStaffPage(["carsales.view", "carsales.reports"]);
  const supabase = createClient();
  const today = new Date();
  const todayS = today.toISOString().slice(0, 10);
  const soonS = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);

  const [{ data: contracts }, { data: charges }, { data: vehicles }] = await Promise.all([
    supabase.from("car_contracts").select("id, contract_no, status, customer:customer_id(name), vehicle:vehicle_id(make, model), car_installments(inst_no, amount, paid_amount, due_date)").in("status", ["active", "completed"]),
    supabase.from("car_service_charges").select("id, due_date, amount, paid_amount, vehicle:vehicle_id(id, make, model, plate_no), customer:customer_id(name)"),
    supabase.from("car_vehicles").select("id, make, model, plate_no, ownership, status, contract_id"),
  ]);

  const dueToday: Alert[] = [], dueSoon: Alert[] = [], overdue: Alert[] = [], holdEligible: Alert[] = [], nearDone: Alert[] = [], completedStillOwned: Alert[] = [], chargeOverdue: Alert[] = [], held: Alert[] = [];

  for (const c of (contracts ?? []) as any[]) {
    const insts = (c.car_installments ?? []) as any[];
    const cn = `${c.contract_no} · ${c.customer?.name ?? ""}`;
    const href = `/car-sales/contracts/${c.id}`;
    let overdueCount = 0;
    for (const i of insts) {
      const rem = Number(i.amount || 0) - Number(i.paid_amount || 0);
      if (rem <= 0.005) continue;
      if (i.due_date === todayS) dueToday.push({ tone: "", text: cn, href, sub: `#${i.inst_no} ${sar(rem)} due today` });
      else if (i.due_date > todayS && i.due_date <= soonS) dueSoon.push({ tone: "", text: cn, href, sub: `#${i.inst_no} ${sar(rem)} due ${dateStr(i.due_date)}` });
      else if (i.due_date < todayS) { overdue.push({ tone: "", text: cn, href, sub: `#${i.inst_no} ${sar(rem)} overdue since ${dateStr(i.due_date)}` }); overdueCount++; }
    }
    if (overdueCount >= 2) holdEligible.push({ tone: "", text: cn, href, sub: `${overdueCount} overdue installments — eligible to hold` });
    const unpaid = insts.filter((i: any) => Number(i.paid_amount || 0) < Number(i.amount || 0)).length;
    if (c.status === "active" && unpaid === 1) nearDone.push({ tone: "", text: cn, href, sub: "1 installment remaining" });
  }

  for (const v of (vehicles ?? []) as any[]) {
    if (v.status === "held") held.push({ tone: "", text: `${vehicleTitle(v)} ${v.plate_no ?? ""}`, href: `/car-sales/vehicles/${v.id}`, sub: "held by Vista" });
  }
  // Completed contracts whose vehicle is still Vista-owned
  for (const c of (contracts ?? []) as any[]) {
    if (c.status !== "completed") continue;
    const v = (vehicles ?? []).find((x: any) => x.contract_id === c.id);
    if (v && v.ownership === "vista") completedStillOwned.push({ tone: "", text: `${c.contract_no} · ${c.customer?.name ?? ""}`, href: `/car-sales/contracts/${c.id}`, sub: "paid off but still under Vista — service charge continues" });
  }
  for (const ch of (charges ?? []) as any[]) {
    const rem = Number(ch.amount || 0) - Number(ch.paid_amount || 0);
    if (rem > 0.005 && ch.due_date < todayS) chargeOverdue.push({ tone: "", text: `${vehicleTitle(ch.vehicle ?? {})} ${ch.vehicle?.plate_no ?? ""}`, href: `/car-sales/service-charges`, sub: `${sar(rem)} service charge overdue (${dateStr(ch.due_date)})` });
  }

  const total = dueToday.length + dueSoon.length + overdue.length + holdEligible.length + nearDone.length + completedStillOwned.length + chargeOverdue.length + held.length;

  return (
    <div className="space-y-4">
      <PageHeader title="Car Sales Alerts" />
      {total === 0 && <div className="card text-slate-500">All clear — no alerts right now.</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Group title="Installments due today" items={dueToday} tone="bg-amber-500" />
        <Group title="Installments overdue" items={overdue} tone="bg-red-500" />
        <Group title="Due in the next 7 days" items={dueSoon} tone="bg-blue-400" />
        <Group title="Eligible to hold (2+ overdue)" items={holdEligible} tone="bg-red-600" />
        <Group title="Service charges overdue" items={chargeOverdue} tone="bg-red-400" />
        <Group title="Contracts nearing completion" items={nearDone} tone="bg-emerald-400" />
        <Group title="Paid off — still under Vista" items={completedStillOwned} tone="bg-indigo-400" />
        <Group title="Vehicles held by Vista" items={held} tone="bg-slate-500" />
      </div>
    </div>
  );
}
