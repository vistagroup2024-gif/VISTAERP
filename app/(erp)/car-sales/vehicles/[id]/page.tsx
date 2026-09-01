import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";
import { VEHICLE_STATUS_LABEL, VEHICLE_STATUS_TONE, OWNERSHIP_LABEL, OWNERSHIP_TONE, sar, vehicleTitle } from "../../lib";

export const dynamic = "force-dynamic";

function D({ l, v }: { l: string; v: any }) {
  return (<><dt className="text-slate-400">{l}</dt><dd className="font-medium">{v ?? "—"}</dd></>);
}

export default async function VehicleDetailPage({ params }: { params: { id: string } }) {
  const access = await guardStaffPage(["carsales.view", "carsales.vehicles"]);
  const supabase = createClient();
  const { data: v } = await supabase
    .from("car_vehicles")
    .select("*, item:product_id(name), supplier:supplier_id(name), customer:current_customer_id(name)")
    .eq("id", params.id).single();
  if (!v) notFound();

  const canManage = staffCan(access, "carsales.vehicles");
  const canCost = staffCan(access, "carsales.cost");

  return (
    <div className="max-w-4xl">
      <PageHeader title={`${vehicleTitle({ ...v, item: (v as any).item?.name })} · ${v.vehicle_no}`}>
        {canManage && <Link href={`/car-sales/vehicles/${v.id}/edit`} className="btn-outline text-sm">Edit</Link>}
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className={`badge ${VEHICLE_STATUS_TONE[v.status] ?? "bg-slate-100"}`}>{VEHICLE_STATUS_LABEL[v.status] ?? v.status}</span>
        <span className={`badge ${OWNERSHIP_TONE[v.ownership] ?? "bg-slate-100"}`}>{OWNERSHIP_LABEL[v.ownership] ?? v.ownership}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Vehicle</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <D l="Item" v={(v as any).item?.name} />
            <D l="Make / Model" v={vehicleTitle({ ...v, item: null })} />
            <D l="Color" v={v.color} />
            <D l="Plate Number" v={v.plate_no} />
            <D l="VIN / Chassis" v={v.vin} />
            <D l="Engine Number" v={v.engine_no} />
            <D l="Current Location" v={v.current_location} />
            <D l="Customer" v={(v as any).customer?.name} />
          </dl>
          {v.notes && <p className="mt-2 text-sm text-slate-500">📝 {v.notes}</p>}
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Purchase</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <D l="Supplier" v={(v as any).supplier?.name} />
            <D l="Purchase Date" v={dateStr(v.purchase_date)} />
            {canCost && <D l="Purchase Cost" v={sar(v.purchase_cost)} />}
            {canCost && <D l="Purchase VAT" v={sar(v.purchase_vat)} />}
            {canCost && <D l="Total Cost" v={sar(v.total_cost)} />}
          </dl>
        </section>
      </div>

      <p className="mt-6 text-sm text-slate-400">
        Sale, installment contract, delivery, holding, transfer and the Monthly Service Charge for this vehicle will appear here as those steps are added.
      </p>
    </div>
  );
}
