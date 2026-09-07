import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import CarInvoiceForm from "./CarInvoiceForm";
import CarInvoiceList, { ContractRow } from "./ContractsTable";
import { vehicleTitle } from "../lib";
import { todaySA } from "@/lib/saudiTime";

export const dynamic = "force-dynamic";

// The Car Invoice opens as a voucher, the way Sales Invoice and Purchase
// Voucher do — the form IS the screen, with New / Previous / Next and the
// invoice number to move between them. The list of every invoice raised is
// still here, under the form, because outstanding and overdue per invoice is
// not something the voucher itself can show.
export default async function CarInvoicePage() {
  const access = await guardStaffPage(["carsales.installments", "carsales.sales"], "car_invoice");
  const supabase = createClient();
  const [{ data: customers }, { data: vehicles }, { data: ccs }, { data: tags }, { data: list }] = await Promise.all([
    supabase.from("parties").select("id, name").eq("party_type", "customer").eq("is_active", true).order("name"),
    // select("*") so is_trading (added by migration 259) is available when
    // present, without breaking before the column exists.
    supabase.from("car_vehicles").select("*, item:product_id(name)").eq("status", "in_stock").order("created_at", { ascending: false }),
    supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
    supabase.from("acct_tag_areas").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
    supabase.from("car_contracts")
      .select("id, contract_no, contract_date, sale_price, advance, status, customer:customer_id(name), vehicle:vehicle_id(vehicle_no, make, model, model_year, plate_no), car_installments(amount, paid_amount, due_date)")
      .order("created_at", { ascending: false }).limit(1000),
  ]);

  const vOpts = (vehicles ?? []).map((v: any) => ({
    id: v.id, label: `${vehicleTitle({ ...v, item: v.item?.name })} · ${v.plate_no ?? v.vehicle_no}`, is_trading: !!v.is_trading,
  }));

  const today = todaySA();
  const rows: ContractRow[] = (list ?? []).map((c: any) => {
    const insts = (c.car_installments ?? []) as any[];
    const paid = insts.reduce((a, i) => a + Number(i.paid_amount || 0), 0);
    const outstanding = Number(c.sale_price || 0) - Number(c.advance || 0) - paid;
    const overdue = insts.reduce((a, i) => a + (i.due_date && i.due_date < today ? Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)) : 0), 0);
    const nextDue = insts
      .filter((i) => Number(i.paid_amount || 0) < Number(i.amount || 0))
      .map((i) => i.due_date).filter(Boolean).sort()[0] ?? null;
    return {
      id: c.id, contract_no: c.contract_no, contract_date: c.contract_date, status: c.status,
      customer: c.customer?.name ?? null,
      vehicle: [c.vehicle?.make, c.vehicle?.model, c.vehicle?.model_year].filter(Boolean).join(" ") || c.vehicle?.vehicle_no || "—",
      plate: c.vehicle?.plate_no ?? null,
      sale_price: Number(c.sale_price || 0), advance: Number(c.advance || 0), paid, outstanding, overdue, next_due: nextDue,
    };
  });

  return (
    <div className="space-y-8">
      <CarInvoiceForm existing={null} installments={[]} customers={(customers ?? []) as any}
        vehicles={vOpts} costCenters={(ccs ?? []) as any} tagAreas={(tags ?? []) as any} />
      <CarInvoiceList rows={rows} canManage={access.unrestricted || !!access.permissions["carsales.installments"]} />
    </div>
  );
}
