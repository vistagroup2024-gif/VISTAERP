import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import CarDoc, { Field } from "../../../CarDoc";
import { sar, vehicleTitle } from "../../../lib";

export const dynamic = "force-dynamic";

export default async function CompletionDoc({ params }: { params: { id: string } }) {
  await guardStaffPage(["carsales.installments", "carsales.sales"]);
  const supabase = createClient();
  const [{ data: c }, { data: insts }] = await Promise.all([
    supabase.from("car_contracts").select("*, customer:customer_id(name, tax_number), vehicle:vehicle_id(make, model, model_year, plate_no, vin, ownership)").eq("id", params.id).single(),
    supabase.from("car_installments").select("amount, paid_amount").eq("contract_id", params.id),
  ]);
  if (!c) notFound();
  const paid = (insts ?? []).reduce((a: number, i: any) => a + Number(i.paid_amount || 0), 0) + Number(c.advance || 0);
  const remaining = Number(c.sale_price || 0) - paid;

  return (
    <CarDoc title="Installment Completion Statement" subtitle={`${c.contract_no}`}>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <Field l="Customer" v={(c as any).customer?.name} />
          <Field l="Iqama / ID" v={(c as any).customer?.tax_number} />
          <Field l="Vehicle" v={vehicleTitle((c as any).vehicle ?? {})} />
          <Field l="Plate / VIN" v={[(c as any).vehicle?.plate_no, (c as any).vehicle?.vin].filter(Boolean).join(" · ")} />
        </div>
        <div>
          <Field l="Contract Value" v={sar(c.sale_price)} />
          <Field l="Total Paid" v={sar(paid)} />
          <Field l="Remaining Balance" v={sar(remaining)} />
          <Field l="Status" v={c.status === "completed" ? "Completed" : "In progress"} />
        </div>
      </div>
      <p className="mt-6 text-xs leading-relaxed text-slate-600">
        {c.status === "completed"
          ? `All installment amounts for this contract have been paid in full. Note: the vehicle remains registered under Vista Group’s name (${(c as any).vehicle?.ownership === "transferred" ? "transferred" : "not yet transferred"}); the monthly service charge continues until an actual transfer is executed.`
          : "This statement reflects the current position; the contract is not yet fully paid."}
      </p>
    </CarDoc>
  );
}
