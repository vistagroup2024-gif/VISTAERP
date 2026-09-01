import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import MasterList from "@/components/accounting/MasterList";

export const dynamic = "force-dynamic";

export default async function WarehousesPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("warehouses").select("id, name, is_active").order("name");
  return (
    <div className="max-w-2xl">
      <PageHeader title="Warehouses" />
      <MasterList table="warehouses" fields={[{ key: "name", label: "Warehouse" }]} initial={(data as any[]) ?? []}
        note="Stock locations. Every stock movement and balance is per warehouse." />
    </div>
  );
}
