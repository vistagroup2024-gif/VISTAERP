import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import CarDoc, { Field } from "../../../CarDoc";
import { sar, vehicleTitle } from "../../../lib";

export const dynamic = "force-dynamic";

export default async function AgreementDoc({ params }: { params: { id: string } }) {
  await guardStaffPage(["carsales.installments", "carsales.sales"]);
  const supabase = createClient();
  const [{ data: c }, { data: insts }] = await Promise.all([
    supabase.from("car_contracts").select("*, customer:customer_id(name, phone, tax_number, address), vehicle:vehicle_id(make, model, variant, model_year, plate_no, vin, color)").eq("id", params.id).single(),
    supabase.from("car_installments").select("*").eq("contract_id", params.id).order("inst_no"),
  ]);
  if (!c) notFound();
  const cust = (c as any).customer, veh = (c as any).vehicle;
  const total = (insts ?? []).reduce((a: number, i: any) => a + Number(i.amount || 0), 0);

  return (
    <CarDoc title="Installment Sale Agreement" subtitle={`${c.contract_no} · ${dateStr(c.contract_date)}`}>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <div className="mb-1 font-semibold text-slate-700">Buyer</div>
          <Field l="Name" v={cust?.name} />
          <Field l="Iqama / ID" v={cust?.tax_number} />
          <Field l="Mobile" v={cust?.phone} />
          <Field l="Address" v={cust?.address} />
        </div>
        <div>
          <div className="mb-1 font-semibold text-slate-700">Vehicle</div>
          <Field l="Vehicle" v={vehicleTitle(veh ?? {})} />
          <Field l="Color" v={veh?.color} />
          <Field l="Plate" v={veh?.plate_no} />
          <Field l="VIN / Chassis" v={veh?.vin} />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Field l="Sale Price" v={sar(c.sale_price)} />
        <Field l="Advance" v={sar(c.advance)} />
        <Field l="Installment Balance" v={sar(Number(c.sale_price || 0) - Number(c.advance || 0))} />
      </div>

      <div className="mt-6">
        <div className="mb-2 font-semibold text-slate-700">Installment Schedule</div>
        <table className="w-full border border-slate-200 text-sm">
          <thead><tr className="bg-slate-50 text-left"><th className="border border-slate-200 px-2 py-1">No.</th><th className="border border-slate-200 px-2 py-1">Due Date</th><th className="border border-slate-200 px-2 py-1 text-right">Amount</th></tr></thead>
          <tbody>
            {(insts ?? []).map((i: any) => (
              <tr key={i.id}><td className="border border-slate-200 px-2 py-1">{i.inst_no}</td><td className="border border-slate-200 px-2 py-1">{dateStr(i.due_date)}</td><td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{sar(i.amount)}</td></tr>
            ))}
            <tr className="font-semibold"><td className="border border-slate-200 px-2 py-1" colSpan={2}>Total</td><td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{sar(total)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-xs leading-relaxed text-slate-600">
        <div className="mb-1 font-semibold text-slate-700">Terms</div>
        <p>1. The vehicle remains registered under {"Vista Group"}’s name until an actual transfer is executed, even after all installments are paid.</p>
        <p>2. A monthly service charge of {sar(1000)} applies for each month the vehicle remains under Vista’s name, from the month of purchase until transfer. This is separate from the installments.</p>
        <p>3. No late penalty is charged. Schedules may be mutually rescheduled by agreement.</p>
        <p>4. Payments are allocated to the specific installment(s) agreed at the time of payment.</p>
      </div>
    </CarDoc>
  );
}
