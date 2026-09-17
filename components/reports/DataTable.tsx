"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { Col } from "@/lib/reports/types";
import { cellText, isNumeric } from "@/lib/reports/export";

export interface DataGroup {
  key: string;
  label: string;
  meta?: React.ReactNode;   // opening balance, a subtitle — drawn beside the label
  rows: any[];
  subtotal?: Record<string, number>;   // pre-computed by the caller (e.g. Ledger's own opening/closing)
  // A second nesting level — Cost Centre Group -> Cost Centre, say. When set,
  // `rows`/`subtotal` on THIS group are ignored in favour of each subgroup's
  // own (a group with subgroups is a heading, not a row of figures itself);
  // every existing caller that never sets this is unaffected.
  subgroups?: DataGroup[];
  indent?: number;   // internal — how deep this group is nested, set by the renderer
}

/**
 * The generic result grid every report page renders instead of its own
 * `<table>` — successor to StockReport's inline Grid, generalised to also
 * take the Ledger's per-account BLOCK shape (`groups`) instead of only a flat
 * row list. Client-side sort and search-within-results run against whatever
 * was fetched (a report's own filters already bounded that at the RPC), so
 * they never re-query; `page`/`onPageChange` are there for a report whose
 * result itself can run long, and are left to the report to wire to its RPC
 * — this component never re-fetches on its own.
 */
export default function DataTable({
  cols, rows, groups, empty, rowClass, page, pageSize, totalCount, onPageChange,
}: {
  cols: Col[];
  rows?: any[];
  groups?: DataGroup[];
  empty: string;
  rowClass?: (row: any) => string;
  page?: number; pageSize?: number; totalCount?: number; onPageChange?: (page: number) => void;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [q, setQ] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(cols.filter((c) => c.hideByDefault).map((c) => c.key)));
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const visibleCols = useMemo(() => cols.filter((c) => !hidden.has(c.key)), [cols, hidden]);
  const isFlat = !groups;

  const matches = (row: any) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return cols.some((c) => String(row[c.key] ?? "").toLowerCase().includes(needle));
  };

  const flatRows = useMemo(() => {
    if (!rows) return [];
    let out = rows.filter(matches);
    if (sort) {
      const { key, dir } = sort;
      out = [...out].sort((a, b) => {
        const av = a[key], bv = b[key];
        const an = Number(av), bn = Number(bv);
        const bothNumeric = av !== null && av !== undefined && av !== "" && bv !== null && bv !== undefined && bv !== "" && !isNaN(an) && !isNaN(bn);
        const cmp = bothNumeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
        return cmp * dir;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort]);

  const filterGroup = (g: DataGroup): DataGroup => g.subgroups
    ? { ...g, subgroups: g.subgroups.map(filterGroup) }
    : { ...g, rows: g.rows.filter(matches) };
  const keepGroup = (g: DataGroup): boolean => g.subgroups
    ? g.subgroups.some(keepGroup)
    : g.rows.length > 0 || !q.trim();

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    return groups.map(filterGroup).filter(keepGroup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, q]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of cols) if (c.total) t[c.key] = flatRows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return t;
  }, [cols, flatRows]);
  const hasTotals = cols.some((c) => c.total);

  function toggleSort(c: Col) {
    if (c.sortable === false) return;
    setSort((s) => {
      if (!s || s.key !== c.key) return { key: c.key, dir: 1 };
      if (s.dir === 1) return { key: c.key, dir: -1 };
      return null;
    });
  }

  const countRows = (g: DataGroup): number => g.subgroups ? g.subgroups.reduce((s, sg) => s + countRows(sg), 0) : g.rows.length;
  const rowCount = isFlat ? flatRows.length : filteredGroups.reduce((s, g) => s + countRows(g), 0);
  const showPager = typeof totalCount === "number" && typeof pageSize === "number" && typeof page === "number" && onPageChange;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-slate-500">
          {rowCount} row{rowCount === 1 ? "" : "s"}
          {typeof totalCount === "number" && totalCount !== rowCount ? ` of ${totalCount}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <input className="input w-44 py-1 text-sm" placeholder="Search results…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="relative">
            <button className="btn-outline text-sm" onClick={() => setColMenuOpen((v) => !v)}>Columns</button>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
                  {cols.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                      <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => {
                        const n = new Set(h); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n;
                      })} />
                      {c.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>{visibleCols.map((c) => (
              <th key={c.key} onClick={() => toggleSort(c)}
                className={`px-3 py-2 ${isNumeric(c) ? "text-right" : "text-left"} ${c.sortable === false ? "" : "cursor-pointer select-none hover:text-slate-600"}`}>
                {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}</tr>
          </thead>
          {isFlat ? (
            <FlatBody cols={visibleCols} rows={flatRows} empty={empty} rowClass={rowClass}
              hasTotals={hasTotals} totals={totals} />
          ) : (
            <GroupedBody cols={visibleCols} groups={filteredGroups} empty={empty}
              collapsed={collapsed} onToggle={(k) => setCollapsed((c) => {
                const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n;
              })} />
          )}
        </table>
      </div>

      {showPager && (
        <div className="mt-2 flex items-center justify-end gap-2 print:hidden">
          <button className="btn-outline text-sm" disabled={page! <= 0} onClick={() => onPageChange!(page! - 1)}>Previous</button>
          <span className="text-sm text-slate-500">Page {page! + 1} of {Math.max(1, Math.ceil(totalCount! / pageSize!))}</span>
          <button className="btn-outline text-sm" disabled={(page! + 1) * pageSize! >= totalCount!} onClick={() => onPageChange!(page! + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}

function FlatBody({ cols, rows, empty, rowClass, hasTotals, totals }: {
  cols: Col[]; rows: any[]; empty: string; rowClass?: (row: any) => string; hasTotals: boolean; totals: Record<string, number>;
}) {
  return (
    <>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={`border-t border-slate-100 ${(rowClass ? rowClass(r) : (r.low || r.short) ? "bg-red-50/50" : "")}`}>
            {cols.map((c) => <Cell key={c.key} col={c} row={r} />)}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-400">{empty}</td></tr>
        )}
      </tbody>
      {rows.length > 0 && hasTotals && (
        <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
          {cols.map((c, i) => (
            <td key={c.key} className={`px-3 py-2 ${isNumeric(c) ? "text-right tabular-nums" : ""}`}>
              {c.total ? cellText(c, totals[c.key]) : i === 0 ? "Total" : ""}
            </td>
          ))}
        </tr></tfoot>
      )}
    </>
  );
}

function GroupedBody({ cols, groups, empty, collapsed, onToggle }: {
  cols: Col[]; groups: DataGroup[]; empty: string; collapsed: Set<string>; onToggle: (key: string) => void;
}) {
  if (groups.length === 0) {
    return <tbody><tr><td colSpan={cols.length} className="px-3 py-8 text-center text-slate-400">{empty}</td></tr></tbody>;
  }
  return <tbody>{groups.map((g) => <GroupRows key={g.key} cols={cols} g={g} depth={0} collapsed={collapsed} onToggle={onToggle} />)}</tbody>;
}

// One group, rendered at its own depth — and, when it has subgroups, each of
// those again, one level deeper. A Cost Centre Group's row is the same shape
// as a Cost Centre's; only the indent and what happens on expand differ.
function GroupRows({ cols, g, depth, collapsed, onToggle }: {
  cols: Col[]; g: DataGroup; depth: number; collapsed: Set<string>; onToggle: (key: string) => void;
}) {
  const open = !collapsed.has(g.key);
  const indent = depth * 16 + 12;
  return (
    <Fragment>
      <tr className={`cursor-pointer border-t-2 border-slate-200 font-semibold ${depth === 0 ? "bg-slate-50" : "bg-slate-50/60"}`} onClick={() => onToggle(g.key)}>
        <td colSpan={cols.length} className="py-2" style={{ paddingLeft: indent }}>
          <span className="mr-1.5 inline-block w-3 text-slate-400">{open ? "▾" : "▸"}</span>
          {g.label}{g.meta}
        </td>
      </tr>
      {open && g.subgroups && g.subgroups.map((sg) => (
        <GroupRows key={sg.key} cols={cols} g={sg} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} />
      ))}
      {open && !g.subgroups && g.rows.map((r, i) => (
        <tr key={`${g.key}-${i}`} className="border-t border-slate-100">
          {cols.map((c, ci) => <Cell key={c.key} col={c} row={r} indent={ci === 0 ? indent + 16 : undefined} />)}
        </tr>
      ))}
      {open && !g.subgroups && g.subtotal && (
        <tr key={`${g.key}-sub`} className="border-t border-slate-200 bg-slate-50/60 font-medium">
          {cols.map((c, i) => (
            <td key={c.key} className={`px-3 py-1.5 ${isNumeric(c) ? "text-right tabular-nums" : ""}`} style={i === 0 ? { paddingLeft: indent + 16 } : undefined}>
              {c.total && g.subtotal![c.key] !== undefined ? cellText(c, g.subtotal![c.key]) : i === 0 ? "Subtotal" : ""}
            </td>
          ))}
        </tr>
      )}
    </Fragment>
  );
}

function Cell({ col, row, indent }: { col: Col; row: any; indent?: number }) {
  const v = row[col.key];
  const style = indent !== undefined ? { paddingLeft: indent } : undefined;
  if (col.kind === "class") {
    const tone = v === "A" ? "bg-green-100 text-green-700" : v === "B" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
    return <td className="px-3 py-2 text-right" style={style}><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{v}</span></td>;
  }
  const text = cellText(col, v);
  const href = col.href?.(row);
  return (
    <td className={`px-3 py-2 ${isNumeric(col) ? "text-right tabular-nums" : ""}`} style={style}>
      {href ? <Link href={href} className="text-brand hover:underline">{text}</Link> : text}
    </td>
  );
}
