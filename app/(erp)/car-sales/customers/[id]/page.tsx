import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { sar, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, vehicleTitle } from "../../lib";

export const dynamic = "force-dynamic";

function Money({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className={`text-lg font-bold tabular-nums ${tone ?? ""}`}>{value}</div></div>;
}

export default async function CustomerProfile({ params }: { params: { id: string } }) {
  await guardStaffPage(["carsales.view", "carsales.installments", "carsales.sales"]);
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: cust }, { data: contracts }, { data: receipts }, { data: charges }] = await Promise.all([
    supabase.from("parties").select("id, name, phone, email, address, tax_number, notes").eq("id", params.id).single(),
    supabase.from("car_contracts").select("id, contract_no, contract_date, sale_price, advance, status, vehicle:vehicle_id(make, model, model_year, plate_no), car_installments(amount, paid_amount, due_date)").eq("customer_id", params.id).order("created_at", { ascending: false }),
    supabase.from("car_receipts").select("receipt_no, receipt_date, amount, method, contract:contract_id(contract_no)").eq("customer_id", params.id).order("receipt_date", { ascending: false }).limit(200),
    supabase.from("car_service_charges").select("amount, paid_amount, due_date").eq("customer_id", params.id),
  ]);
  if (!cust) notFound();

  const C = (contracts ?? []) as any[];
  let value = 0, paid = 0, outstanding = 0, overdue = 0;
  for (const c of C) {
    if (c.status === "cancelled") continue;
    const insts = c.car_installments ?? [];
    const p = insts.reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
    value += Number(c.sale_price || 0); paid += Number(c.advance || 0) + p;
    outstanding += Number(c.sale_price || 0) - Number(c.advance || 0) - p;
    overdue += insts.filter((i: any) => i.due_date < today).reduce((a: number, i: any) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
  }
  const scOut = (charges ?? []).reduce((a: number, c: any) => a + Math.max(0, Number(c.amount || 0) - Number(c.paid_amount || 0)), 0);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title={cust.name} />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Customer</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-400">Iqama / ID</dt><dd className="font-medium">{cust.tax_number ?? "—"}</dd>
            <dt className="text-slate-400">Mobile</dt><dd className="font-medium">{cust.phone ?? "—"}</dd>
            <dt className="text-slate-400">Email</dt><dd className="font-medium">{cust.email ?? "—"}</dd>
            <dt className="text-slate-400">Address</dt><dd className="font-medium">{cust.address ?? "—"}</dd>
          </dl>
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Financial Summary</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Money label="Contract Value" value={sar(value)} />
            <Money label="Total Paid" value={sar(paid)} tone="text-emerald-700" />
            <Money label="Outstanding" value={sar(outstanding)} />
            <Money label="Overdue" value={sar(overdue)} tone="text-red-600" />
            <Money label="Service Charge Due" value={sar(scOut)} tone="text-amber-700" />
            <Money label="Cars" value={String(C.length)} />
          </div>
        </section>
      </div>

      <section className="card overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-semibold text-slate-700">Contracts</h2>
        <table className="mt-2 w-full min-w-[820px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Contract</th><th className="th">Vehicle</th><th className="th">Date</th>
            <th className="th text-right">Value</th><th className="th text-right">Outstanding</th><th className="th">Status</th>
          </tr></thead>
          <tbody>
            {C.map((c) => {
              const p = (c.car_installments ?? []).reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0);
              const out = Number(c.sale_price || 0) - Number(c.advance || 0) - p;
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="td"><Link href={`/car-sales/contracts/${c.id}`} className="text-brand hover:underline">{c.contract_no}</Link></td>
                  <td className="td">{vehicleTitle(c.vehicle ?? {})}</td>
                  <td className="td">{dateStr(c.contract_date)}</td>
                  <td className="td text-right tabular-nums">{sar(c.sale_price)}</td>
                  <td className="td text-right tabular-nums">{sar(out)}</td>
                  <td className="td"><span className={`badge ${CONTRACT_STATUS_TONE[c.status] ?? "bg-slate-100"}`}>{CONTRACT_STATUS_LABEL[c.status] ?? c.status}</span></td>
                </tr>
              );
            })}
            {C.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No contracts.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card overflow-x-auto p-0">
        <h2 className="px-4 pt-4 font-semibold text-slate-700">Receipts</h2>
        <table className="mt-2 w-full min-w-[640px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Receipt</th><th className="th">Date</th><th className="th">Contract</th><th className="th">Method</th><th className="th text-right">Amount</th>
          </tr></thead>
          <tbody>
            {(receipts ?? []).map((r: any) => (
              <tr key={r.receipt_no} className="border-t border-slate-100">
                <td className="td">{r.receipt_no}</td><td className="td">{dateStr(r.receipt_date)}</td>
                <td className="td">{r.contract?.contract_no ?? "—"}</td><td className="td capitalize">{r.method}</td>
                <td className="td text-right tabular-nums">{sar(r.amount)}</td>
              </tr>
            ))}
            {(receipts ?? []).length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No receipts.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
