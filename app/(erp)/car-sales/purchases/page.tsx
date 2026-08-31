import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, staffCan } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import PurchaseOrdersTable, { PORow } from "./PurchaseOrdersTable";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const access = await guardStaffPage("carsales.purchase");
  const supabase = createClient();
  const { data } = await supabase
    .from("car_purchase_orders")
    .select("id, po_no, po_date, expected_date, status, notes, supplier:supplier_id(name), car_purchase_order_items(id, received, purchase_cost, purchase_vat)")
    .order("created_at", { ascending: false })
    .limit(1000);

  const rows: PORow[] = (data ?? []).map((o: any) => {
    const items = (o.car_purchase_order_items ?? []) as any[];
    return {
      id: o.id, po_no: o.po_no, po_date: o.po_date, expected_date: o.expected_date, status: o.status,
      supplier: o.supplier?.name ?? null, vehicles: items.length, received: items.filter((i) => i.received).length,
      value: items.reduce((a, i) => a + Number(i.purchase_cost || 0) + Number(i.purchase_vat || 0), 0),
    };
  });

  const canManage = staffCan(access, "carsales.purchase");
  return (
    <div>
      <RealtimeRefresh tables={["car_purchase_orders", "car_purchase_order_items"]} />
      <PageHeader title="Purchase Orders" action={canManage ? { href: "/car-sales/purchases/new", label: "New Purchase Order" } : undefined} />
      <PurchaseOrdersTable rows={rows} canManage={canManage} />
    </div>
  );
}
