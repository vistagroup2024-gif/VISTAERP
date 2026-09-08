import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import ReceiptsTable, { ReceiptRow } from "./ReceiptsTable";
import AdvanceReceiptPanel, { PendingOrder } from "./AdvanceReceiptPanel";

export const dynamic = "force-dynamic";

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function ReceiptsPage() {
  await guardStaffPage("carsales.receipts");
  const supabase = createClient();

  const [{ data }, { data: pending }] = await Promise.all([
    supabase
      .from("car_receipts")
      .select("id, receipt_no, receipt_date, amount, method, reference, contract:contract_id(id, contract_no), source:source_doc_id(id, doc_no), customer:customer_id(name)")
      .order("receipt_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2000),
    // The one authority on "a car sale order still waiting for its invoice".
    supabase.rpc("car_pending_sale_orders"),
  ]);

  const rows: ReceiptRow[] = (data ?? []).map((r: any) => ({
    id: r.id, receipt_no: r.receipt_no, receipt_date: r.receipt_date, amount: num(r.amount),
    method: r.method, reference: r.reference,
    contract_id: r.contract?.id ?? null, contract_no: r.contract?.contract_no ?? null,
    source_doc_id: r.source?.id ?? null, source_doc_no: r.source?.doc_no ?? null,
    customer: r.customer?.name ?? null,
  }));

  // The agreed advance lives in the order's own Car Sales Details (meta), and
  // what has been received against it is on the receipts themselves.
  const ids = ((pending ?? []) as any[]).map((o) => o.id);
  const [{ data: metas }, { data: taken }] = ids.length
    ? await Promise.all([
        supabase.from("trade_documents").select("id, meta").in("id", ids),
        supabase.from("car_receipts").select("source_doc_id, amount").in("source_doc_id", ids),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  const advanceOf = new Map<string, number>((metas ?? []).map((d: any) => [d.id, num(d.meta?.advance)]));
  const receivedOf = new Map<string, number>();
  for (const t of (taken ?? []) as any[]) {
    receivedOf.set(t.source_doc_id, (receivedOf.get(t.source_doc_id) ?? 0) + num(t.amount));
  }

  const orders: PendingOrder[] = ((pending ?? []) as any[]).map((o) => ({
    id: o.id, doc_no: o.doc_no, doc_date: o.doc_date, party_name: o.party_name,
    cost_center: o.cost_center, total: num(o.total),
    advance: advanceOf.get(o.id) ?? 0, received: receivedOf.get(o.id) ?? 0,
  }));

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["car_receipts"]} />
      <PageHeader title="Receipts" />
      <AdvanceReceiptPanel orders={orders} />
      <ReceiptsTable rows={rows} />
    </div>
  );
}
