import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import { dateStr } from "@/lib/format";
import CarDoc, { Field } from "../../../CarDoc";
import { vehicleTitle } from "../../../lib";

export const dynamic = "force-dynamic";

export default async function TransferDoc({ params }: { params: { id: string } }) {
  await guardStaffPage("carsales.ownership");
  const supabase = createClient();
  const { data: c } = await supabase.from("car_contracts")
    .select("contract_no, vehicle_id, customer:customer_id(name), vehicle:vehicle_id(make, model, model_year, plate_no, vin)")
    .eq("id", params.id).single();
  if (!c) notFound();
  const { data: tr } = await supabase.from("car_transfers").select("*").eq("vehicle_id", (c as any).vehicle_id).order("transfer_date", { ascending: false }).limit(1).maybeSingle();
  if (!tr) notFound();
  const veh = (c as any).vehicle;

  return (
    <CarDoc title="Vehicle Transfer Record" subtitle={c.contract_no}>
      <div className="grid grid-cols-2 gap-8">
        <div>
          <Field l="Customer" v={(c as any).customer?.name} />
          <Field l="Vehicle" v={vehicleTitle(veh ?? {})} />
          <Field l="Plate" v={veh?.plate_no} />
          <Field l="VIN / Chassis" v={veh?.vin} />
        </div>
        <div>
          <Field l="Transfer Date" v={dateStr((tr as any).transfer_date)} />
          <Field l="Destination / Company" v={(tr as any).destination} />
          <Field l="Reference" v={(tr as any).reference} />
        </div>
      </div>
      <p className="mt-6 text-xs leading-relaxed text-slate-600">
        Ownership of the above vehicle has been transferred out of Vista Group’s name as recorded. Monthly service
        charges cease from the transfer date; charges accrued prior to transfer remain payable.
      </p>
      {(tr as any).notes && <p className="mt-2 text-xs text-slate-500">Notes: {(tr as any).notes}</p>}
    </CarDoc>
  );
}
