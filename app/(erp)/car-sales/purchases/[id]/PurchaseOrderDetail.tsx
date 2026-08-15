"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";
import { PO_STATUS_LABEL, PO_STATUS_TONE, sar, vehicleTitle } from "../../lib";

export default function PurchaseOrderDetail({ po, items, canManage }: { po: any; items: any[]; canManage: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pending = items.filter((i) => !i.received).length;
  const total = items.reduce((a, i) => a + Number(i.purchase_cost || 0) + Number(i.purchase_vat || 0), 0);

  async function call(fn: string, args: any, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="card flex flex-wrap items-center gap-3">
        <span className={`badge ${PO_STATUS_TONE[po.status] ?? "bg-slate-100"}`}>{PO_STATUS_LABEL[po.status] ?? po.status}</span>
        <span className="text-sm text-slate-400">{items.length} vehicle{items.length === 1 ? "" : "s"} · {items.length - pending} received</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canManage && po.status !== "received" && <Link href={`/car-sales/purchases/${po.id}/edit`} className="btn-outline text-sm">Edit</Link>}
          {canManage && po.status === "draft" && <button disabled={busy} className="btn-outline text-sm" onClick={() => call("car_po_set_status", { p_id: po.id, p_status: "ordered" })}>Mark Ordered</button>}
          {canManage && po.status !== "received" && po.status !== "cancelled" && pending > 0 &&
            <button disabled={busy} className="btn text-sm" onClick={() => call("car_po_receive", { p_id: po.id }, `Receive ${pending} vehicle(s) into stock? This creates vehicle records.`)}>Receive into Stock ({pending})</button>}
          {canManage && po.status !== "received" && po.status !== "cancelled" &&
            <button disabled={busy} className="btn-outline text-sm text-red-600" onClick={() => call("car_po_set_status", { p_id: po.id, p_status: "cancelled" }, "Cancel this purchase order?")}>Cancel</button>}
        </div>
      </div>

      <section className="card">
        <dl className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
          <dt className="text-slate-400">Supplier</dt><dd className="font-medium">{po.supplier_name ?? "—"}</dd>
          <dt className="text-slate-400">PO Date</dt><dd className="font-medium">{dateStr(po.po_date)}</dd>
          <dt className="text-slate-400">Expected</dt><dd className="font-medium">{dateStr(po.expected_date)}</dd>
          <dt className="text-slate-400">Total</dt><dd className="font-medium">{sar(total)}</dd>
        </dl>
        {po.notes && <p className="mt-2 text-sm text-slate-500">📝 {po.notes}</p>}
      </section>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Vehicle</th><th className="th">Plate</th><th className="th">VIN</th>
            <th className="th text-right">Cost</th><th className="th text-right">VAT</th><th className="th">Stock</th>
          </tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="td">{vehicleTitle(i)}<div className="text-xs text-slate-400">{i.color ?? ""}</div></td>
                <td className="td">{i.plate_no ?? "—"}</td>
                <td className="td font-mono text-xs">{i.vin ?? "—"}</td>
                <td className="td text-right tabular-nums">{sar(i.purchase_cost)}</td>
                <td className="td text-right tabular-nums">{sar(i.purchase_vat)}</td>
                <td className="td">{i.received
                  ? <Link href={`/car-sales/vehicles/${i.vehicle_id}`} className="text-brand hover:underline">{i.vehicle?.vehicle_no ?? "In stock"}</Link>
                  : <span className="badge bg-slate-100 text-slate-500">Not received</span>}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No vehicles on this order.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
