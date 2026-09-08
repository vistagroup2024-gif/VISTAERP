"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type WfNode = {
  doc_type: string; label: string; sort: number; module: string;
  source_type: string | null; alt_source_type: string | null; alt_source_label: string | null;
  next_type: string | null; is_trade: boolean; is_custom: boolean;
  total: number; pending: number | null;
  pending_po: number | null; pending_invoice: number | null;
};

const HREF: Record<string, string> = {
  sales_quotation: "/accounting/sales/quotations",
  sale_order: "/accounting/sales/orders",
  sales_invoice: "/accounting/sales/invoices",
  delivery_note: "/accounting/sales/delivery-notes",
  sales_return: "/accounting/sales/returns",
  purchase_order: "/accounting/purchases/orders",
  mrn: "/accounting/purchases/mrn",
  purchase_voucher: "/accounting/purchases/vouchers",
  purchase_return: "/accounting/purchases/returns",
  supplier_bill: "/purchase/bills",
  car_invoice: "/car-sales/contracts",
  car_expense: "/car-sales/vehicles",
  car_charges: "/car-sales/service-charges",
  gl_receipt: "/accounting/receipts",
  gl_payment: "/accounting/payments",
  gl_contra: "/accounting/contra",
  gl_petty: "/accounting/petty-cash",
  gl_pdc: "/accounting/pdc",
  gl_journal: "/accounting/journal/new",
  invoice_bill: "/accounting/invoices",
  gl_recurring: "/accounting/recurring",
  visa_invoice: "/accounting/visa-invoices",
  transport_invoice: "/accounting/transport-invoices",
  hotel_invoice: "/accounting/hotel-invoices",
  gl_payroll: "/hr/payroll",
  stock_documents: "/stock/documents",
  stock_indents: "/stock/indents",
};

/**
 * The workflow board, drawn from the definition rather than from a layout
 * written here.
 *
 * Two halves, because there are two kinds of step. A step that is loaded from
 * another one belongs to a CHAIN, and the chain is drawn: the depth of a step
 * is how far along it sits, and a second child starts a new row at its parent's
 * depth, which is what puts the purchase branch beside the Sale Order without
 * anybody positioning it. A step that is loaded from nothing and feeds nothing
 * — a Receipt, a Journal Entry, Payroll — has no chain to draw, so those are
 * listed under their module instead of being strung out in a row of one.
 *
 * A step can have a SECOND source (a Delivery Note and a Sales Return are both
 * raised from a Car Invoice as well as from the chain). The chain draws the
 * first; the second is named on the card, because a card can only sit in one
 * place and the alternative is the board quietly showing half the truth.
 */
export default function WorkFlowBoard({ reloadKey = 0 }: { reloadKey?: number }) {
  const supabase = createClient();
  const [nodes, setNodes] = useState<WfNode[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("workflow_summary");
      setNodes((data as WfNode[]) ?? []);
    })();
  }, [supabase, reloadKey]);

  const { rows, loose } = useMemo(() => {
    if (!nodes) return { rows: [], loose: [] as WfNode[] };
    const byType = new Map(nodes.map((n) => [n.doc_type, n]));

    // In the chain if it is loaded from something, or something is loaded from
    // it — by either of its two sources.
    const isSource = new Set<string>();
    for (const n of nodes) {
      if (n.source_type && byType.has(n.source_type)) isSource.add(n.source_type);
      if (n.alt_source_type && byType.has(n.alt_source_type)) isSource.add(n.alt_source_type);
    }
    const chained = nodes.filter(
      (n) => (n.source_type && byType.has(n.source_type)) ||
             (n.alt_source_type && byType.has(n.alt_source_type)) ||
             isSource.has(n.doc_type));
    const loose = nodes.filter((n) => !chained.includes(n));

    const inChain = new Map(chained.map((n) => [n.doc_type, n]));
    const kids = new Map<string | null, WfNode[]>();
    for (const n of chained) {
      const k = n.source_type && inChain.has(n.source_type) ? n.source_type : null;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k)!.push(n);
    }
    Array.from(kids.values()).forEach((a) => a.sort((x, y) => x.sort - y.sort));

    const depth = new Map<string, number>();
    const depthOf = (n: WfNode, guard = 0): number => {
      if (depth.has(n.doc_type)) return depth.get(n.doc_type)!;
      const src = n.source_type ? inChain.get(n.source_type) : undefined;
      const d = !src || guard > 40 ? 0 : depthOf(src, guard + 1) + 1;
      depth.set(n.doc_type, d);
      return d;
    };
    chained.forEach((n) => depthOf(n));

    const out: { indent: number; items: WfNode[] }[] = [];
    const seen = new Set<string>();
    const walk = (n: WfNode, row: WfNode[]) => {
      if (seen.has(n.doc_type)) return;
      seen.add(n.doc_type);
      row.push(n);
      const cs = kids.get(n.doc_type) ?? [];
      cs.forEach((c, i) => {
        if (i === 0) walk(c, row);
        else { const r: WfNode[] = []; walk(c, r); if (r.length) out.push({ indent: depth.get(c.doc_type)!, items: r }); }
      });
    };
    for (const root of kids.get(null) ?? []) {
      const row: WfNode[] = [];
      walk(root, row);
      if (row.length) out.push({ indent: depth.get(root.doc_type)!, items: row });
    }
    for (const n of chained) if (!seen.has(n.doc_type)) out.push({ indent: depth.get(n.doc_type) ?? 0, items: [n] });
    return { rows: out.sort((a, b) => a.indent - b.indent), loose };
  }, [nodes]);

  const byModule = useMemo(() => {
    const m = new Map<string, WfNode[]>();
    for (const n of loose) {
      if (!m.has(n.module)) m.set(n.module, []);
      m.get(n.module)!.push(n);
    }
    Array.from(m.values()).forEach((a) => a.sort((x, y) => x.sort - y.sort));
    return Array.from(m.entries());
  }, [loose]);

  if (!nodes) return <p className="text-sm text-slate-400">Loading…</p>;
  if (nodes.length === 0) return <p className="text-sm text-slate-400">Every step is switched off — nothing to show.</p>;

  const Arrow = ({ dotted }: { dotted?: boolean }) => (
    <div className="flex shrink-0 items-center px-1 text-slate-400" aria-hidden>
      <span className={`h-px w-6 ${dotted ? "border-t-2 border-dotted border-slate-400" : "bg-slate-400"}`} />
      <span className="-ml-1 text-xs">▸</span>
    </div>
  );

  const Card = ({ n }: { n: WfNode }) => (
    <Link href={HREF[n.doc_type] ?? "#"} className="block w-56 shrink-0 rounded-md border border-slate-300 bg-white shadow-sm transition-colors hover:border-brand-400">
      <div className="flex items-center justify-between rounded-t-[5px] bg-slate-200/80 px-3 py-1.5">
        <span className="text-sm font-semibold text-slate-700">{n.label}</span>
        {n.is_custom
          ? <span className="rounded bg-brand-100 px-1 text-[9px] font-semibold uppercase text-brand-700">yours</span>
          : <span className="h-3 w-3 rounded-sm bg-slate-400" />}
      </div>
      <div className="space-y-1 px-3 py-2 text-sm">
        {n.is_trade ? (
          <div className="flex justify-between">
            <span className="text-slate-500">Total Documents</span>
            <span className="font-semibold tabular-nums text-brand-700 underline">{n.total}</span>
          </div>
        ) : (
          <div className="text-xs text-slate-400">Open the screen</div>
        )}
        {/* A Sale Order is pending twice over — once down each branch. */}
        {n.pending_po !== null && (
          <div className="flex justify-between"><span className="text-slate-500">Pending SO → PO</span>
            <span className="font-semibold tabular-nums text-brand-700 underline">{n.pending_po}</span></div>
        )}
        {n.pending_invoice !== null && (
          <div className="flex justify-between"><span className="text-slate-500">Pending SO → Invoice</span>
            <span className="font-semibold tabular-nums text-brand-700 underline">{n.pending_invoice}</span></div>
        )}
        {n.pending_po === null && n.pending_invoice === null && n.pending !== null && n.is_trade && (
          <div className="flex justify-between"><span className="text-slate-500">Pending Documents</span>
            <span className={`font-semibold tabular-nums ${n.pending > 0 ? "text-brand-700 underline" : "text-slate-700"}`}>{n.pending}</span></div>
        )}
        {/* The second source. Named rather than drawn, because the card is
            already sitting under the first one. */}
        {n.alt_source_type && (
          <div className="border-t border-dashed border-slate-200 pt-1 text-xs text-slate-500">
            also from <span className="font-medium text-slate-600">{n.alt_source_label ?? n.alt_source_type}</span>
          </div>
        )}
      </div>
    </Link>
  );

  return (
    <div className="space-y-8 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-6">
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-center gap-1">
          {Array.from({ length: row.indent }).map((_, i) => (
            <span key={i} className="flex shrink-0 items-center">
              <span className="w-56 shrink-0" />
              <span className="invisible" aria-hidden><Arrow /></span>
            </span>
          ))}
          {row.indent > 0 && <Arrow dotted />}
          {row.items.map((n, i) => (
            <span key={n.doc_type} className="flex items-center">
              {i > 0 && <Arrow />}
              <Card n={n} />
            </span>
          ))}
        </div>
      ))}

      {byModule.map(([mod, items]) => (
        <div key={mod} className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{mod}</h3>
          <div className="flex flex-wrap gap-2">
            {items.map((n) => <Card key={n.doc_type} n={n} />)}
          </div>
        </div>
      ))}

      <p className="text-xs text-slate-400">
        The chain is drawn; a voucher that is raised on its own is listed under its module. Pending means
        nothing downstream has loaded it yet — exactly what the next voucher&rsquo;s Load button offers.
      </p>
    </div>
  );
}
