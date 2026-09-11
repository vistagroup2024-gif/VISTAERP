import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import CarInvoiceForm from "./CarInvoiceForm";
import { vehicleTitle } from "../lib";

export const dynamic = "force-dynamic";

// The Car Invoice opens as a voucher, the way Sales Invoice and Purchase
// Voucher do — the form IS the screen, with New / Previous / Next and the
// invoice number to move between them.
//
// There is no list of every invoice underneath it any more. A voucher screen is
// for the one voucher in front of you; the list made the screen long enough that
// the form's own buttons scrolled away, and outstanding-per-invoice is what the
// Car Sales reports are for. Nothing is lost — the same figures are on
// Reports → Outstanding and on the Car Customer Balances dashboard card.
export default async function CarInvoicePage() {
  await guardStaffPage(["carsales.installments", "carsales.sales"], "car_invoice");
  const supabase = createClient();
  const [{ data: customers }, { data: vehicles }, { data: ccs }, { data: tags }] = await Promise.all([
    supabase.from("parties").select("id, name").eq("party_type", "customer").eq("is_active", true).order("name"),
    // select("*") so is_trading (added by migration 259) is available when
    // present, without breaking before the column exists.
    supabase.from("car_vehicles").select("*, item:product_id(name)").eq("status", "in_stock").order("created_at", { ascending: false }),
    supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
    supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
  ]);

  const vOpts = (vehicles ?? []).map((v: any) => ({
    id: v.id, label: `${vehicleTitle({ ...v, item: v.item?.name })} · ${v.plate_no ?? v.vehicle_no}`, is_trading: !!v.is_trading,
  }));

  return (
    <div className="space-y-8">
      <CarInvoiceForm existing={null} installments={[]} customers={(customers ?? []) as any}
        vehicles={vOpts} costCenters={(ccs ?? []) as any} tagAreas={(tags ?? []) as any} />
    </div>
  );
}
