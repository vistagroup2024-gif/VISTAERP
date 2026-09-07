import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { guardStaffPage } from "@/lib/staffSession";
import CarInvoiceForm from "../../CarInvoiceForm";
import { vehicleTitle } from "../../../lib";

export const dynamic = "force-dynamic";

export default async function EditCarInvoicePage({ params }: { params: { id: string } }) {
  await guardStaffPage("carsales.installments", "car_invoice");
  const supabase = createClient();
  const { data: c } = await supabase.from("car_contracts").select("*").eq("id", params.id).single();
  if (!c) notFound();
  if (c.status !== "draft") notFound();

  const [{ data: installments }, { data: customers }, { data: vehicles }, { data: ccs }, { data: tags }] = await Promise.all([
    supabase.from("car_installments").select("*").eq("contract_id", params.id).order("inst_no"),
    supabase.from("parties").select("id, name").eq("party_type", "customer").eq("is_active", true).order("name"),
    supabase.from("car_vehicles").select("*, item:product_id(name)").or(`status.eq.in_stock,id.eq.${c.vehicle_id}`).order("created_at", { ascending: false }),
    supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
    supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
  ]);
  const vOpts = (vehicles ?? []).map((v: any) => ({
    id: v.id, label: `${vehicleTitle({ ...v, item: v.item?.name })} · ${v.plate_no ?? v.vehicle_no}`, is_trading: !!v.is_trading,
  }));
  return (
    <CarInvoiceForm existing={c} installments={(installments ?? []) as any} customers={(customers ?? []) as any}
      vehicles={vOpts} costCenters={(ccs ?? []) as any} tagAreas={(tags ?? []) as any} />
  );
}
