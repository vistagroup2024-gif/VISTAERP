"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type WfNode = {
  doc_type: string; label: string; sort: number;
  source_type: string | null; next_type: string | null;
  total: number; pending: number | null;
  pending_po: number | null; pending_invoice: number | null;
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
 * The workflow board, drawn from the definition rather than from a layout
 * written here. Each step knows what it is loaded FROM, so the depth of a step
 * is how far along the chain it sits, and a step whose parent already has a
 * child starts a new row at that same depth — which is how the purchase branch
 * comes to sit beside the Sale Order it comes off, without anybody positioning
 * it. Switch a step off in Work Flow Definitions and it leaves the board and
 * the chain closes up behind it.
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

  // Rows of steps, each row a run along the chain; the first child continues
  // its parent's row and any other child begins one of its own.
  const rows = useMemo(() => {
    if (!nodes) return [];
    const byType = new Map(nodes.map((n) => [n.doc_type, n]));
    const kids = new Map<string | null, WfNode[]>();
    for (const n of nodes) {
      const k = n.source_type && byType.has(n.source_type) ? n.source_type : null;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k)!.push(n);
    }
    Array.from(kids.values()).forEach((a) => a.sort((x, y) => x.sort - y.sort));

    const depth = new Map<string, number>();
    const depthOf = (n: WfNode, guard = 0): number => {
      if (depth.has(n.doc_type)) return depth.get(n.doc_type)!;
      const src = n.source_type ? byType.get(n.source_type) : undefined;
      const d = !src || guard > 20 ? 0 : depthOf(src, guard + 1) + 1;
      depth.set(n.doc_type, d);
      return d;
    };
    nodes.forEach((n) => depthOf(n));

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
    // Anything unreachable from a root still deserves a place.
    for (const n of nodes) if (!seen.has(n.doc_type)) out.push({ indent: depth.get(n.doc_type) ?? 0, items: [n] });
    return out.sort((a, b) => a.indent - b.indent);
  }, [nodes]);

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
        <span className="h-3 w-3 rounded-sm bg-slate-400" />
      </div>
      <div className="space-y-1 px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Total Documents</span>
          <span className="font-semibold tabular-nums text-brand-700 underline">{n.total}</span>
        </div>
        {/* A Sale Order is pending twice over — once down each branch. */}
        {n.pending_po !== null && (
          <div className="flex justify-between"><span className="text-slate-500">Pending SO → PO</span>
            <span className="font-semibold tabular-nums text-brand-700 underline">{n.pending_po}</span></div>
        )}
        {n.pending_invoice !== null && (
          <div className="flex justify-between"><span className="text-slate-500">Pending SO → Invoice</span>
            <span className="font-semibold tabular-nums text-brand-700 underline">{n.pending_invoice}</span></div>
        )}
        {n.pending_po === null && n.pending_invoice === null && n.pending !== null && (
          <div className="flex justify-between"><span className="text-slate-500">Pending Documents</span>
            <span className={`font-semibold tabular-nums ${n.pending > 0 ? "text-brand-700 underline" : "text-slate-700"}`}>{n.pending}</span></div>
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

      {/* The car branch also comes off the Sale Order, but a Car Invoice is not
          a trade document — it lives in Car Sales — so it is linked, not counted. */}
      <div className="flex items-center gap-1">
        <span className="flex shrink-0 items-center">
          <span className="w-56 shrink-0" /><span className="invisible" aria-hidden><Arrow /></span>
        </span>
        <span className="flex shrink-0 items-center">
          <span className="w-56 shrink-0" /><span className="invisible" aria-hidden><Arrow /></span>
        </span>
        <Arrow dotted />
        <Link href="/car-sales/contracts" className="block w-56 shrink-0 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-brand-400">
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
