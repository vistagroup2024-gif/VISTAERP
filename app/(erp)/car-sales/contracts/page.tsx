import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ContractsTable, { ContractRow } from "./ContractsTable";

export const dynamic = "force-dynamic";

export default async function ContractsPage() {
  const access = await guardStaffPage(["carsales.installments", "carsales.sales"]);
  const supabase = createClient();
  const { data } = await supabase
    .from("car_contracts")
    .select("id, contract_no, contract_date, sale_price, advance, status, customer:customer_id(name), vehicle:vehicle_id(vehicle_no, make, model, model_year, plate_no), car_installments(amount, paid_amount, due_date)")
    .order("created_at", { ascending: false })
    .limit(1000);

  const today = new Date().toISOString().slice(0, 10);
  const rows: ContractRow[] = (data ?? []).map((c: any) => {
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
    <div>
      <RealtimeRefresh tables={["car_contracts", "car_installments"]} />
      <PageHeader title="Installment Contracts" action={staffCan(access, "carsales.installments") ? { href: "/car-sales/contracts/new", label: "+ New Contract" } : undefined} />
      <ContractsTable rows={rows} canManage={staffCan(access, "carsales.installments")} />
    </div>
  );
}
