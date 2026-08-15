import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ReceiptsTable, { ReceiptRow } from "./ReceiptsTable";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  await guardStaffPage("carsales.receipts");
  const supabase = createClient();
  const { data } = await supabase
    .from("car_receipts")
    .select("id, receipt_no, receipt_date, amount, method, reference, contract:contract_id(id, contract_no), customer:customer_id(name)")
    .order("receipt_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows: ReceiptRow[] = (data ?? []).map((r: any) => ({
    id: r.id, receipt_no: r.receipt_no, receipt_date: r.receipt_date, amount: Number(r.amount || 0),
    method: r.method, reference: r.reference, contract_id: r.contract?.id ?? null, contract_no: r.contract?.contract_no ?? null,
    customer: r.customer?.name ?? null,
  }));

  return (
    <div>
      <RealtimeRefresh tables={["car_receipts"]} />
      <PageHeader title="Receipts" />
      <ReceiptsTable rows={rows} />
    </div>
  );
}
