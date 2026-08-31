"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// One node as returned by the acct_tree RPC (flat list; tree built client-side).
export type AcctNode = {
  id: string; code: string; name: string; name_ar: string | null;
  nature: "asset" | "liability" | "equity" | "income" | "expense" | "control";
  is_group: boolean; is_postable: boolean; parent_id: string | null; path: string | null;
  currency: string; subtype: string | null; status: string;
  own_debit: number; own_credit: number;
};

const NATURE_BADGE: Record<string, string> = {
  asset: "bg-blue-100 text-blue-700",
  liability: "bg-amber-100 text-amber-700",
  equity: "bg-purple-100 text-purple-700",
  income: "bg-green-100 text-green-700",
  expense: "bg-red-100 text-red-700",
  control: "bg-slate-200 text-slate-600",
};

function money(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}
// Dr/Cr suffix from a signed net (debit − credit).
function drcr(net: number) {
  if (Math.abs(net) < 0.005) return <span className="text-slate-300">0.00</span>;
  return (
    <span className={net >= 0 ? "text-slate-800" : "text-slate-800"}>
      {money(net)} <span className="text-[10px] font-semibold text-slate-400">{net >= 0 ? "Dr" : "Cr"}</span>
    </span>
  );
}

export default function AccountTree({ nodes }: { nodes: AcctNode[] }) {
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Rolled-up net (debit − credit) for every node = own + all descendants (by path prefix).
  const rollup = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of nodes) {
      const own = Number(n.own_debit) - Number(n.own_credit);
      const pfx = (n.path ?? "") + "/";
      let sum = own;
      if (n.is_group) {
        for (const d of nodes) {
          if (d.id !== n.id && d.path && d.path.startsWith(pfx)) sum += Number(d.own_debit) - Number(d.own_credit);
        }
      }
      m.set(n.id, sum);
    }
    return m;
  }, [nodes]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, AcctNode[]>();
    for (const n of nodes) {
      const k = n.parent_id;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(n);
    }
    Array.from(m.values()).forEach((arr) => arr.sort((a: AcctNode, b: AcctNode) => a.code.localeCompare(b.code, undefined, { numeric: true })));
    return m;
  }, [nodes]);

  // Search: keep matching nodes plus their ancestors so context is preserved.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const keep = new Set<string>();
    for (const n of nodes) {
      const hay = `${n.code} ${n.name} ${n.name_ar ?? ""} ${n.subtype ?? ""}`.toLowerCase();
      if (hay.includes(needle)) {
        keep.add(n.id);
        let p = n.parent_id;
        while (p && !keep.has(p)) { keep.add(p); p = byId.get(p)?.parent_id ?? null; }
      }
    }
    return keep;
  }, [q, nodes]);

  const roots = childrenOf.get(null) ?? [];

  function toggle(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function Row({ n, depth }: { n: AcctNode; depth: number }) {
    if (visible && !visible.has(n.id)) return null;
    const kids = childrenOf.get(n.id) ?? [];
    const hasKids = kids.length > 0;
    const isOpen = visible ? true : !collapsed.has(n.id);
    const net = rollup.get(n.id) ?? 0;
    // Group rows are shaded a touch stronger the higher up the tree they sit, so
    // multiple nesting levels stay visually distinct.
    const groupBg = n.is_group ? (depth === 0 ? "bg-slate-100" : depth === 1 ? "bg-slate-50" : "bg-slate-50/60") : "";
    return (
      <>
        <div className={`group flex items-stretch border-b border-slate-100 hover:bg-brand-50/40 ${groupBg}`}>
          {/* Tree guide lines: one per ancestor level */}
          {Array.from({ length: depth }).map((_, i) => (
            <span key={i} className="shrink-0 border-l border-slate-400" style={{ width: "var(--tree-indent, 18px)" }} />
          ))}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1 pr-2 sm:gap-2 sm:pr-3">
            {hasKids ? (
              <button onClick={() => toggle(n.id)} className="w-4 shrink-0 text-slate-400 hover:text-slate-700" aria-label={isOpen ? "Collapse" : "Expand"}>
                {isOpen ? "▾" : "▸"}
              </button>
            ) : <span className="w-4 shrink-0" />}
            {/* Folder (group) vs leaf (postable account) icon */}
            {n.is_group ? (
              <svg viewBox="0 0 24 24" width="16" height="16" className="shrink-0 text-amber-500" fill="currentColor" aria-hidden>
                <path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" opacity=".25" />
                <path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" className="shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeLinecap="round" />
              </svg>
            )}
            <span className={`min-w-0 flex-1 truncate ${n.is_group ? "font-semibold text-slate-800" : "text-slate-700"}`}>
              {n.is_postable ? (
                <Link href={`/accounting/ledger?account=${n.id}`} className="hover:text-brand hover:underline">{n.name}</Link>
              ) : n.name}
              {n.status !== "active" && <span className="ml-2 rounded bg-slate-200 px-1.5 text-[10px] uppercase text-slate-500">{n.status}</span>}
            </span>
            {!n.is_group && <span className={`badge ${NATURE_BADGE[n.nature]} hidden shrink-0 sm:inline-flex`}>{n.subtype ?? n.nature}</span>}
            <span className={`w-20 shrink-0 text-right tabular-nums text-xs sm:w-40 sm:text-sm ${n.is_group ? "font-semibold" : ""}`}>{drcr(net)}</span>
            <span className="hidden w-16 shrink-0 text-right sm:block">
              <Link href={`/accounting/accounts/new?parent=${n.id}`} className="invisible text-xs text-brand group-hover:visible" title="Add sub-account">+ add</Link>
            </span>
          </div>
        </div>
        {isOpen && hasKids && kids.map((k) => <Row key={k.id} n={k} depth={depth + 1} />)}
      </>
    );
  }

  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search code, name, Arabic, type…" className="input max-w-xs" />
        <button onClick={() => setCollapsed(new Set())} className="btn-outline text-xs">Expand all</button>
        <button onClick={() => setCollapsed(new Set(nodes.filter((n) => n.is_group).map((n) => n.id)))} className="btn-outline text-xs">Collapse all</button>
        <span className="ml-auto text-xs text-slate-400">{nodes.length} accounts</span>
      </div>
      <div className="hidden items-center gap-2 border-b border-slate-200 bg-slate-50 py-2 pr-3 pl-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:flex">
        <span className="w-4" /><span className="flex-1">Account</span>
        <span className="w-40 text-right">Balance</span><span className="w-16" />
      </div>
      <div className="max-h-[70vh] overflow-auto text-sm [--tree-indent:11px] sm:[--tree-indent:18px]">
        {roots.map((r) => <Row key={r.id} n={r} depth={0} />)}
        {roots.length === 0 && <div className="p-6 text-center text-slate-400">No accounts.</div>}
      </div>
    </div>
  );
}
