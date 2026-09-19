"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { Col } from "@/lib/reports/types";
import { cellText, isNumeric } from "@/lib/reports/export";

// A negative money or percentage figure reads red — the same convention
// every professional accounting product uses (a loss, a negative margin, a
// shortfall) so it registers at a glance rather than needing the reader to
// notice the minus sign. Deliberately not qty/int: a negative quantity isn't
// a "loss" the same way, so this stays scoped to the two kinds that carry
// profit-and-loss meaning.
const NEGATIVE_KINDS = new Set(["money", "pct"]);
function negativeClass(col: Col, v: any): string {
  if (!col.kind || !NEGATIVE_KINDS.has(col.kind)) return "";
  const n = Number(v);
  return !isNaN(n) && n < 0 ? "text-red-600" : "";
}

export interface DataGroup {
  key: string;
  label: string;
  meta?: React.ReactNode;   // opening balance, a subtitle — drawn beside the label
  rows: any[];
  subtotal?: Record<string, number | null>;   // pre-computed by the caller (e.g. Ledger's own opening/closing)
  // A second nesting level — Cost Centre Group -> Cost Centre, say. When set,
  // `rows`/`subtotal` on THIS group are ignored in favour of each subgroup's
  // own (a group with subgroups is a heading, not a row of figures itself);
  // every existing caller that never sets this is unaffected.
  subgroups?: DataGroup[];
  // When set, the group's own header row renders real cells for every column
  // after the first (via the same `cellText`/kind formatting a data row
  // gets) instead of collapsing to one colSpan cell holding just the label —
  // a group that IS a P&L row in its own right (its own Revenue/COGS/Net),
  // not only a heading over the rows beneath it. A caller that never sets
  // this keeps the label-only heading row, unchanged.
  values?: Record<string, any>;
  indent?: number;   // internal — how deep this group is nested, set by the renderer
}

/**
 * The generic result grid every report page renders instead of its own
 * `<table>` — successor to StockReport's inline Grid, generalised to also
 * take the Ledger's per-account BLOCK shape (`groups`) instead of only a flat
 * row list. Client-side sort runs against whatever was fetched (a report's
 * own filters already bounded that at the RPC), so it never re-queries;
 * filtering is the column HEADER (click to sort) rather than a separate
 * search box — there is no search-within-results box or a Columns toggle
 * any more, a `hideByDefault` column just stays hidden. `page`/`onPageChange`
 * are there for a report whose result itself can run long, and are left to
 * the report to wire to its RPC — this component never re-fetches on its own.
 */
export default function DataTable({
  cols, rows, groups, empty, rowClass, page, pageSize, totalCount, onPageChange, bare, roomy,
}: {
  cols: Col[];
  rows?: any[];
  groups?: DataGroup[];
  empty: string;
  rowClass?: (row: any) => string;
  page?: number; pageSize?: number; totalCount?: number; onPageChange?: (page: number) => void;
  // Skip the outer .card border/shadow — for a caller that draws its own
  // merged card around a dark-green header and this table (P&L Summary),
  // so the header sits flush on top of the grid instead of two separate boxes.
  bare?: boolean;
  // A touch more row/header padding for a table a caller wants to read as
  // less cramped (P&L Summary, asked for directly) — opt-in per caller
  // rather than a change to every report built on this component.
  roomy?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  // Tracks which groups are OPEN, not which are closed — so the empty set
  // this starts as means every group starts collapsed. A report opens
  // showing its group totals only; a group's own rows appear once the
  // viewer clicks its ▸, never before.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleCols = useMemo(() => cols.filter((c) => !c.hideByDefault), [cols]);
  const isFlat = !groups;

  const flatRows = useMemo(() => {
    if (!rows) return [];
    let out = rows;
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
  }, [rows, sort]);

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

  const showPager = typeof totalCount === "number" && typeof pageSize === "number" && typeof page === "number" && onPageChange;
  const headPy = roomy ? "py-2.5" : "py-2";

  return (
    <div>
      <div className={bare ? "overflow-x-auto text-sm" : "card overflow-x-auto p-0 text-sm"}>
        <table className="report-grid w-full border-collapse">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
            <tr>{visibleCols.map((c) => (
              <th key={c.key}
                className={`border border-slate-200 px-3 ${headPy} ${isNumeric(c) ? "text-right" : "text-left"}`}>
                <span onClick={() => toggleSort(c)} className={`col-resize ${c.sortable === false ? "" : "cursor-pointer select-none hover:text-brand-900"}`}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </span>
              </th>
            ))}</tr>
          </thead>
          {isFlat ? (
            <FlatBody cols={visibleCols} rows={flatRows} empty={empty} rowClass={rowClass}
              hasTotals={hasTotals} totals={totals} roomy={roomy} />
          ) : (
            <GroupedBody cols={visibleCols} groups={groups ?? []} empty={empty}
              expanded={expanded} onToggle={(k) => setExpanded((c) => {
                const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n;
              })} roomy={roomy} />
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

function FlatBody({ cols, rows, empty, rowClass, hasTotals, totals, roomy }: {
  cols: Col[]; rows: any[]; empty: string; rowClass?: (row: any) => string; hasTotals: boolean; totals: Record<string, number>; roomy?: boolean;
}) {
  const py = roomy ? "py-2.5" : "py-2";
  return (
    <>
      <tbody>
        {rows.map((r, i) => {
          const state = rowClass ? rowClass(r) : (r.low || r.short) ? "bg-red-50/50" : "";
          return (
            <tr key={i} className={state || (i % 2 === 1 ? "bg-slate-100/80" : "")}>
              {cols.map((c) => <Cell key={c.key} col={c} row={r} roomy={roomy} />)}
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr><td colSpan={cols.length} className="border border-slate-200 px-3 py-8 text-center text-slate-400">{empty}</td></tr>
        )}
      </tbody>
      {rows.length > 0 && hasTotals && (
        <tfoot><tr className="bg-slate-50 font-semibold">
          {cols.map((c, i) => (
            <td key={c.key} className={`border border-slate-200 px-3 ${py} ${isNumeric(c) ? "text-right tabular-nums" : ""} ${c.total ? negativeClass(c, totals[c.key]) : ""}`}>
              {c.total ? cellText(c, totals[c.key]) : i === 0 ? "Total" : ""}
            </td>
          ))}
        </tr></tfoot>
      )}
    </>
  );
}

function GroupedBody({ cols, groups, empty, expanded, onToggle, roomy }: {
  cols: Col[]; groups: DataGroup[]; empty: string; expanded: Set<string>; onToggle: (key: string) => void; roomy?: boolean;
}) {
  if (groups.length === 0) {
    return <tbody><tr><td colSpan={cols.length} className="border border-slate-200 px-3 py-8 text-center text-slate-400">{empty}</td></tr></tbody>;
  }
  return <tbody>{groups.map((g, i) => <GroupRows key={g.key} cols={cols} g={g} depth={0} idx={i} expanded={expanded} onToggle={onToggle} roomy={roomy} />)}</tbody>;
}

// One group, rendered at its own depth — and, when it has subgroups, each of
// those again, one level deeper. A Cost Centre Group's row is the same shape
// as a Cost Centre's; only the indent and what happens on expand differ.
function GroupRows({ cols, g, depth, idx, expanded, onToggle, roomy }: {
  cols: Col[]; g: DataGroup; depth: number; idx: number; expanded: Set<string>; onToggle: (key: string) => void; roomy?: boolean;
}) {
  // A group with nothing beneath it (no subgroups, an empty rows array) gets
  // no chevron and no click handler — expanding it would show nothing, so
  // don't offer to. A P&L Filteration mode with Month wise switched off is
  // exactly this: the group's own header row already carries its totals via
  // `values`, and there is no month drill to reveal under it.
  const hasChildren = !!(g.subgroups && g.subgroups.length) || (!g.subgroups && g.rows && g.rows.length > 0);
  const open = hasChildren && expanded.has(g.key);
  const indent = depth * 16 + 12;
  // Zebra by sibling position, not by depth — a static per-depth shade meant
  // every top-level group row read the same flat grey as its neighbours;
  // this is the same alternating-by-index convention every flat table uses.
  const zebra = idx % 2 === 1 ? "bg-slate-100/80" : "";
  const py = roomy ? "py-2.5" : "py-2";
  const subPy = roomy ? "py-2" : "py-1.5";
  return (
    <Fragment>
      <tr className={`font-semibold ${zebra} ${hasChildren ? "cursor-pointer" : ""}`} onClick={hasChildren ? () => onToggle(g.key) : undefined}>
        {g.values ? (
          <>
            <td className={`border border-slate-200 ${py}`} style={{ paddingLeft: indent }}>
              {hasChildren && <span className="mr-1.5 inline-block w-3 text-slate-400">{open ? "▾" : "▸"}</span>}
              {g.label}{g.meta}
            </td>
            {cols.slice(1).map((c) => <Cell key={c.key} col={c} row={g.values!} roomy={roomy} />)}
          </>
        ) : (
          <td colSpan={cols.length} className={`border border-slate-200 ${py}`} style={{ paddingLeft: indent }}>
            {hasChildren && <span className="mr-1.5 inline-block w-3 text-slate-400">{open ? "▾" : "▸"}</span>}
            {g.label}{g.meta}
          </td>
        )}
      </tr>
      {open && g.subgroups && g.subgroups.map((sg, si) => (
        <GroupRows key={sg.key} cols={cols} g={sg} depth={depth + 1} idx={si} expanded={expanded} onToggle={onToggle} roomy={roomy} />
      ))}
      {open && !g.subgroups && g.rows.map((r, i) => (
        <tr key={`${g.key}-${i}`} className={i % 2 === 1 ? "bg-slate-100/80" : ""}>
          {cols.map((c, ci) => <Cell key={c.key} col={c} row={r} indent={ci === 0 ? indent + 16 : undefined} roomy={roomy} />)}
        </tr>
      ))}
      {/* A values-bearing group's own header row already IS the subtotal —
          a footer repeating the same figures under it, once expanded, is a
          duplicate, not a summary. Only a plain label-only heading (no
          `values`) still needs this line to show a total for what's below it. */}
      {open && !g.subgroups && g.subtotal && !g.values && (
        <tr key={`${g.key}-sub`} className="bg-slate-50/60 font-medium">
          {cols.map((c, i) => (
            <td key={c.key} className={`border border-slate-200 px-3 ${subPy} ${isNumeric(c) ? "text-right tabular-nums" : ""} ${c.total && g.subtotal![c.key] !== undefined ? negativeClass(c, g.subtotal![c.key]) : ""}`} style={i === 0 ? { paddingLeft: indent + 16 } : undefined}>
              {c.total && g.subtotal![c.key] !== undefined ? cellText(c, g.subtotal![c.key]) : i === 0 ? "Subtotal" : ""}
            </td>
          ))}
        </tr>
      )}
    </Fragment>
  );
}

function Cell({ col, row, indent, roomy }: { col: Col; row: any; indent?: number; roomy?: boolean }) {
  const v = row[col.key];
  const style = indent !== undefined ? { paddingLeft: indent } : undefined;
  const py = roomy ? "py-2.5" : "py-2";
  if (col.kind === "class") {
    const tone = v === "A" ? "bg-green-100 text-green-700" : v === "B" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
    return <td className={`border border-slate-200 px-3 ${py} text-right`} style={style}><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{v}</span></td>;
  }
  const text = cellText(col, v);
  const href = col.href?.(row);
  const neg = negativeClass(col, v);
  return (
    <td className={`border border-slate-200 px-3 ${py} ${isNumeric(col) ? "text-right tabular-nums" : ""} ${neg}`} style={style}>
      {href ? <Link href={href} className={`hover:underline ${neg || "text-brand"}`}>{text}</Link> : text}
    </td>
  );
}
