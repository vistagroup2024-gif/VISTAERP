import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import CarDoc, { Field } from "../../../CarDoc";
import { vehicleTitle } from "../../../lib";

export const dynamic = "force-dynamic";

export default async function HandoverDoc({ params }: { params: { id: string } }) {
  await guardStaffPage(["carsales.ownership", "carsales.installments"]);
  const supabase = createClient();
  // The delivery record is keyed on the contract id from the URL, not on
  // anything the contract row says, so the two go out together.
  const [{ data: c }, { data: del }] = await Promise.all([
    supabase.from("car_contracts")
      .select("contract_no, delivery_date, customer:customer_id(name, phone), vehicle:vehicle_id(id, make, model, model_year, plate_no, vin, color)")
      .eq("id", params.id).single(),
    supabase.from("car_deliveries").select("*").eq("contract_id", params.id).order("delivery_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!c) notFound();
  const veh = (c as any).vehicle;

  return (
    <CarDoc title="Vehicle Handover Form" subtitle={c.contract_no}>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <Field l="Customer" v={(c as any).customer?.name} />
          <Field l="Mobile" v={(c as any).customer?.phone} />
          <Field l="Delivery Date" v={dateStr((del as any)?.delivery_date ?? c.delivery_date)} />
          <Field l="Delivered By" v={(del as any)?.delivered_by} />
          <Field l="Acknowledged By" v={(del as any)?.acknowledged_by} />
        </div>
        <div>
          <Field l="Vehicle" v={vehicleTitle(veh ?? {})} />
          <Field l="Color" v={veh?.color} />
          <Field l="Plate" v={veh?.plate_no} />
          <Field l="VIN / Chassis" v={veh?.vin} />
          <Field l="Odometer" v={(del as any)?.odometer} />
        </div>
      </div>
      <p className="mt-6 text-xs leading-relaxed text-slate-600">
        The customer acknowledges receipt of the above vehicle in acceptable condition. The vehicle remains registered
        under Vista Group’s name; ownership does not transfer until an actual transfer is executed.
      </p>
      {(del as any)?.notes && <p className="mt-2 text-xs text-slate-500">Notes: {(del as any).notes}</p>}
    </CarDoc>
  );
}
