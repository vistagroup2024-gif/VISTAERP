"use client";

import { useState } from "react";
import TreePickList, { type TreeNode } from "./TreePickList";

export type QtyNode = TreeNode & { uom?: string | null; qty?: number };

const qtyf = (n: any) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n) || 0);

/** The modal item/product picker behind the "Items"/"Product"/"Product Group"
 *  filter needs — the same tree UI the Inventory reports' own item picker
 *  used, now over TreePickList so it is not a second implementation of group
 *  toggling. Fed a plain `nodes` prop rather than calling `stock_item_tree`
 *  itself, so a report can point it at the stock item tree (with quantity
 *  balances) OR the plain Product Tree (acct_products) for a non-stock
 *  product/product-group filter, without two components. */
export default function ItemPickTree({ title, nodes, selected, onOk, onCancel, showQty = true }: {
  title: string;
  nodes: QtyNode[];
  selected: string[] | null;
  onOk: (ids: string[] | null) => void;
  onCancel: () => void;
  showQty?: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(selected ?? []));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
        </div>
        <div className="min-h-0 flex-1">
          {nodes.length === 0
            ? <p className="px-3 py-8 text-center text-sm text-slate-400">Nothing to pick from.</p>
            : <TreePickList nodes={nodes} checked={checked} onChange={setChecked}
                trailing={showQty ? (n) => `${qtyf(n.qty)}${n.uom ? ` ${n.uom}` : ""}` : undefined} />}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button className="btn-outline" onClick={onCancel}>Cancel</button>
          <button className="btn" onClick={() => onOk(checked.size === 0 ? null : Array.from(checked))}>OK</button>
        </div>
      </div>
    </div>
  );
}
