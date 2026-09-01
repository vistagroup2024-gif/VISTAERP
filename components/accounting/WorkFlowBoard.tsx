"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Node = {
  doc_type: string; label: string; total: number;
  pending: number | null; pending_po: number | null; pending_invoice: number | null;
};

const HREF: Record<string, string> = {
  sales_quotation: "/accounting/sales/quotations",
  sale_order: "/accounting/sales/orders",
  sales_invoice: "/accounting/sales/invoices",
  delivery_note: "/accounting/sales/delivery-notes",
  purchase_order: "/accounting/purchases/orders",
  mrn: "/accounting/purchases/mrn",
  purchase_voucher: "/accounting/purchases/vouchers",
};

/**
 * The workflow board: every document in the chain with how many exist and how
 * many are still waiting to be carried to the next step. "Pending" is exactly
 * what the Load list on the next voucher will offer.
 */
export default function WorkFlowBoard() {
  const supabase = createClient();
  const [nodes, setNodes] = useState<Record<string, Node> | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("workflow_summary");
      const m: Record<string, Node> = {};
      for (const n of ((data as Node[]) ?? [])) m[n.doc_type] = n;
      setNodes(m);
    })();
  }, [supabase]);

  if (!nodes) return <p className="text-sm text-slate-400">Loading…</p>;

  const Card = ({ type, pendingLabel, pending }: { type: string; pendingLabel?: string; pending?: number | null }) => {
    const n = nodes[type];
    if (!n) return null;
    const p = pending !== undefined ? pending : n.pending;
    return (
      <Link href={HREF[type] ?? "#"} className="block w-56 rounded-md border border-slate-300 bg-white shadow-sm transition-colors hover:border-brand-400">
        <div className="flex items-center justify-between rounded-t-[5px] bg-slate-200/80 px-3 py-1.5">
          <span className="text-sm font-semibold text-slate-700">{n.label}</span>
          <span className="h-3 w-3 rounded-sm bg-slate-400" />
        </div>
        <div className="space-y-1 px-3 py-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Total Documents</span>
            <span className="font-semibold tabular-nums text-brand-700 underline">{n.total}</span>
          </div>
          {p !== null && p !== undefined && (
            <div className="flex justify-between">
              <span className="text-slate-500">{pendingLabel ?? "Pending Documents"}</span>
              <span className={`font-semibold tabular-nums ${p > 0 ? "text-brand-700 underline" : "text-slate-700"}`}>{p}</span>
            </div>
          )}
        </div>
      </Link>
    );
  };

  const Arrow = ({ dotted }: { dotted?: boolean }) => (
    <div className="flex shrink-0 items-center px-1 text-slate-400" aria-hidden>
      <span className={`h-px w-6 ${dotted ? "border-t-2 border-dotted border-slate-400" : "bg-slate-400"}`} />
      <span className="-ml-1 text-xs">▸</span>
    </div>
  );

  const so = nodes["sale_order"];

  return (
    <div className="space-y-8 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-6">
      {/* The purchase side: what we owe the supplier for. */}
      <div className="flex items-center gap-1">
        <div className="w-56 shrink-0" />
        <Arrow dotted />
        <Card type="purchase_order" />
        <Arrow />
        <Card type="mrn" />
        <Arrow />
        <Card type="purchase_voucher" />
      </div>

      {/* The spine: quotation to order. */}
      <div className="flex items-center gap-1">
        <Card type="sales_quotation" />
        <Arrow />
        <Link href={HREF.sale_order} className="block w-56 rounded-md border border-slate-300 bg-white shadow-sm transition-colors hover:border-brand-400">
          <div className="flex items-center justify-between rounded-t-[5px] bg-slate-200/80 px-3 py-1.5">
            <span className="text-sm font-semibold text-slate-700">Sale Orders</span>
            <span className="h-3 w-3 rounded-sm bg-slate-400" />
          </div>
          <div className="space-y-1 px-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Total Documents</span>
              <span className="font-semibold tabular-nums text-brand-700 underline">{so?.total ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Pending SO → PO</span>
              <span className="font-semibold tabular-nums text-brand-700 underline">{so?.pending_po ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Pending SO → Invoice</span>
              <span className="font-semibold tabular-nums text-brand-700 underline">{so?.pending_invoice ?? 0}</span></div>
          </div>
        </Link>
        <Arrow />
        <Card type="sales_invoice" />
        <Arrow />
        <Card type="delivery_note" />
      </div>

      {/* The car branch lives in its own module, so it is linked, not counted here. */}
      <div className="flex items-center gap-1">
        <div className="w-56 shrink-0" />
        <Arrow />
        <Link href="/car-sales/contracts" className="block w-56 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-brand-400">
          <p className="font-semibold text-slate-700">Car Invoice</p>
          <p className="text-xs text-slate-400">A car Sale Order is invoiced in Car Sales, then delivered.</p>
        </Link>
      </div>

      <p className="text-xs text-slate-400">
        Pending means nothing downstream has loaded it yet — exactly what the next voucher&rsquo;s Load button offers.
      </p>
    </div>
  );
}
