"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ReportFilters, { defaultFilters, type Filters } from "./ReportFilters";
import { money, qtyf } from "./reportFormat";

type Grp = {
  id: string; name: string; parent_id: string | null;
  opening_qty: number; opening_value: number; in_qty: number; in_value: number;
  out_qty: number; out_value: number; closing_qty: number; closing_value: number;
};
type Itm = Grp & { item_id: string; item: string; uom: string | null; group_id: string | null };

const HEAD = ["Name", "Opening Qty", "Opening Value", "Receipt Qty", "Receipt Value",
  "Issue Qty", "Issue Value", "Closing Qty", "Closing Value"];

/**
 * Multi-level Stock Movement: the stock statement drawn on the product-group
 * tree, every group carrying the totals of everything nested beneath it.
 */
export default function MultiLevelMovement() {
  const supabase = createClient();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [data, setData] = useState<{ groups: Grp[]; items: Itm[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  async function run() {
    setBusy(true); setErr(null);
    const { data: d, error } = await supabase.rpc("stock_movement_multilevel", {
      p_from: filters.from, p_to: filters.to, p_items: filters.items,
      p_wh: filters.warehouse, p_moved_only: filters.movedOnly,
    });
    setBusy(false);
    if (error) { setErr(error.message); setData({ groups: [], items: [] }); return; }
    setData((d as any) ?? { groups: [], items: [] });
  }

  const byParent = useMemo(() => {
    const m = new Map<string | null, Grp[]>();
    for (const g of data?.groups ?? []) { const k = g.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(g); }
    m.forEach((a) => a.sort((x, y) => x.name.localeCompare(y.name)));
    return m;
  }, [data]);

  const itemsOf = useMemo(() => {
    const m = new Map<string | null, Itm[]>();
    for (const i of data?.items ?? []) { const k = i.group_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(i); }
    m.forEach((a) => a.sort((x, y) => x.item.localeCompare(y.item)));
    return m;
  }, [data]);

  // A group whose parent is not itself in the result set is a root of the report.
  const known = useMemo(() => new Set((data?.groups ?? []).map((g) => g.id)), [data]);
  const roots = useMemo(() => (data?.groups ?? []).filter((g) => !g.parent_id || !known.has(g.parent_id))
    .sort((a, b) => a.name.localeCompare(b.name)), [data, known]);
  const orphans = itemsOf.get(null) ?? [];

  function Num({ v, money: isMoney }: { v: number; money?: boolean }) {
    return <td className="px-3 py-1.5 text-right tabular-nums">{isMoney ? money(v) : qtyf(v)}</td>;
  }

  function GroupRows({ g, depth }: { g: Grp; depth: number }): JSX.Element {
    const open = !collapsed[g.id];
    const subs = byParent.get(g.id) ?? [];
    const its = itemsOf.get(g.id) ?? [];
    return (
      <>
        <tr className="border-t border-slate-100 bg-slate-50 font-semibold text-slate-700">
          <td className="px-3 py-1.5" style={{ paddingLeft: 12 + depth * 18 }}>
            <button className="mr-1 text-slate-400" onClick={() => setCollapsed((c) => ({ ...c, [g.id]: open }))}>
              {open ? "▾" : "▸"}
            </button>
            {g.name}
          </td>
          <Num v={g.opening_qty} /><Num v={g.opening_value} money />
          <Num v={g.in_qty} /><Num v={g.in_value} money />
          <Num v={g.out_qty} /><Num v={g.out_value} money />
          <Num v={g.closing_qty} /><Num v={g.closing_value} money />
        </tr>
        {open && subs.map((s) => <GroupRows key={s.id} g={s} depth={depth + 1} />)}
        {open && its.map((i) => (
          <tr key={i.item_id} className="border-t border-slate-100">
            <td className="px-3 py-1.5" style={{ paddingLeft: 12 + (depth + 1) * 18 }}>
              {i.item}{i.uom ? <span className="text-slate-400"> · {i.uom}</span> : null}
            </td>
            <Num v={i.opening_qty} /><Num v={i.opening_value} money />
            <Num v={i.in_qty} /><Num v={i.in_value} money />
            <Num v={i.out_qty} /><Num v={i.out_value} money />
            <Num v={i.closing_qty} /><Num v={i.closing_value} money />
          </tr>
        ))}
      </>
    );
  }

  return (
    <div>
      <div className="print:hidden">
        <ReportFilters needs={["from", "to", "items", "warehouse", "movedOnly"]}
          value={filters} onChange={setFilters} onRun={run} busy={busy} />
      </div>
      {err && <div className="mb-3 rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {data === null && <p className="text-sm text-slate-400">Choose the range and run the report.</p>}
      {data && roots.length === 0 && orphans.length === 0 && (
        <p className="card text-center text-sm text-slate-400">Nothing to report for this period.</p>
      )}
      {data && (roots.length > 0 || orphans.length > 0) && (
        <>
          <div className="mb-2 flex justify-end print:hidden">
            <button className="btn-outline" onClick={() => window.print()}>Print</button>
          </div>
          <div className="card overflow-x-auto p-0 text-sm">
            <table className="w-full">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <tr>{HEAD.map((h, i) => (
                  <th key={h} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {roots.map((g) => <GroupRows key={g.id} g={g} depth={0} />)}
                {orphans.map((i) => (
                  <tr key={i.item_id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5">{i.item}</td>
                    <Num v={i.opening_qty} /><Num v={i.opening_value} money />
                    <Num v={i.in_qty} /><Num v={i.in_value} money />
                    <Num v={i.out_qty} /><Num v={i.out_value} money />
                    <Num v={i.closing_qty} /><Num v={i.closing_value} money />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
