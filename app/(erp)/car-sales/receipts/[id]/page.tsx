import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import CarDoc, { Field } from "../../CarDoc";
import { sar } from "../../lib";

export const dynamic = "force-dynamic";

export default async function ReceiptDoc({ params }: { params: { id: string } }) {
  await guardStaffPage("carsales.receipts");
  const supabase = createClient();
  const { data: r } = await supabase.from("car_receipts")
    .select("*, customer:customer_id(name, phone), contract:contract_id(contract_no), car_receipt_allocations(amount, target_type, installment:installment_id(inst_no, due_date))")
    .eq("id", params.id).single();
  if (!r) notFound();
  const allocs = ((r as any).car_receipt_allocations ?? []) as any[];

  return (
    <CarDoc title="Payment Receipt" subtitle={`${r.receipt_no} · ${dateStr(r.receipt_date)}`}>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <Field l="Received From" v={(r as any).customer?.name} />
          <Field l="Mobile" v={(r as any).customer?.phone} />
          <Field l="Contract" v={(r as any).contract?.contract_no} />
        </div>
        <div>
          <Field l="Date" v={dateStr(r.receipt_date)} />
          <Field l="Method" v={String(r.method).replace(/^\w/, (m) => m.toUpperCase())} />
          <Field l="Reference" v={r.reference} />
        </div>
      </div>
      <div className="mt-6">
        <div className="mb-2 font-semibold text-slate-700">Allocation</div>
        <div className="overflow-x-auto">
        <table className="w-full border border-slate-200 text-sm">
          <thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-2 py-1">Applied To</th><th className="border border-slate-200 px-2 py-1 text-right">Amount</th></tr></thead>
          <tbody>
            {allocs.map((a, i) => (
              <tr key={i}><td className="border border-slate-200 px-2 py-1">{a.target_type === "advance" ? "Advance" : `Installment #${a.installment?.inst_no ?? ""}${a.installment?.due_date ? ` (${dateStr(a.installment.due_date)})` : ""}`}</td><td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{sar(a.amount)}</td></tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <div className="mt-6 flex justify-end">
        <div className="rounded-lg bg-slate-50 px-6 py-3 text-right">
          <div className="text-xs uppercase text-slate-500">Amount Received</div>
          <div className="text-2xl font-bold tabular-nums">{sar(r.amount)}</div>
        </div>
      </div>
    </CarDoc>
  );
}
