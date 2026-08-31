"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import ProductRatesModal from "./ProductRatesModal";

type Node = { id: string; parent_id: string | null; name: string; is_group: boolean; is_active: boolean; sort: number; [k: string]: any };
type Extra = { key: string; label: string };

// Reusable hierarchical master (Product Tree, Cost Center, Tag Area). Supports
// groups + items and optional numeric `extra` field(s) shown on item rows.
// Pass a single `extra` or several via `extras`.
export default function TreeMaster({ table, initial, extra, extras, note, rateEditor }: {
  table: string; initial: Node[]; extra?: Extra; extras?: Extra[]; note?: string; rateEditor?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [ratesFor, setRatesFor] = useState<Node | null>(null);
  const exs = useMemo<Extra[]>(() => extras ?? (extra ? [extra] : []), [extras, extra]);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [isGroup, setIsGroup] = useState(true);
  const [extraVals, setExtraVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => initial.filter((n) => n.is_group), [initial]);
  const byParent = useMemo(() => {
    const m = new Map<string | null, Node[]>();
    for (const n of initial) { const k = n.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(n); }
    m.forEach((arr) => arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
    return m;
  }, [initial]);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!name.trim()) return setErr("Name is required");
    setBusy(true);
    const payload: any = { company_id: COMPANY_ID, name: name.trim(), parent_id: parent || null, is_group: isGroup };
    if (!isGroup) for (const e of exs) payload[e.key] = extraVals[e.key] ? Number(extraVals[e.key]) : 0;
    const { error } = await supabase.from(table).insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    setName(""); setExtraVals({}); router.refresh();
  }
  async function rename(n: Node) {
    const v = prompt("Rename:", n.name); if (v === null || !v.trim()) return;
    await supabase.from(table).update({ name: v.trim() }).eq("id", n.id); router.refresh();
  }
  async function setExtra(n: Node, e: Extra) {
    const v = prompt(`${e.label}:`, String(n[e.key] ?? 0)); if (v === null) return;
    await supabase.from(table).update({ [e.key]: Number(v) || 0 }).eq("id", n.id); router.refresh();
  }
  async function del(n: Node) {
    if ((byParent.get(n.id)?.length ?? 0) > 0) return setErr(`"${n.name}" has children — remove them first.`);
    if (!confirm(`Delete "${n.name}"?`)) return;
    const { error } = await supabase.from(table).delete().eq("id", n.id);
    if (error) return setErr(error.message);
    router.refresh();
  }

  function Row({ n, depth }: { n: Node; depth: number }) {
    const kids = byParent.get(n.id) ?? [];
    const isOpen = open[n.id] ?? true;
    const groupBg = n.is_group ? (depth === 0 ? "bg-slate-100" : depth === 1 ? "bg-slate-50" : "bg-slate-50/60") : "";
    return (
      <div>
        <div className={`group flex items-stretch border-b border-slate-100 hover:bg-brand-50/40 ${groupBg}`}>
          {Array.from({ length: depth }).map((_, i) => (
            <span key={i} className="shrink-0 border-l border-slate-400" style={{ width: 18 }} />
          ))}
          <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1 pr-3">
            {n.is_group && kids.length > 0
              ? <button onClick={() => setOpen((o) => ({ ...o, [n.id]: !isOpen }))} className="w-4 shrink-0 text-slate-400 hover:text-slate-700">{isOpen ? "▾" : "▸"}</button>
              : <span className="w-4 shrink-0" />}
            {n.is_group ? (
              <svg viewBox="0 0 24 24" width="16" height="16" className="shrink-0 text-amber-500" fill="currentColor" aria-hidden>
                <path d="M3 8a2 2 0 012-2h4l2 2h8a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" className="shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeLinecap="round" />
              </svg>
            )}
            <span className={`min-w-0 truncate ${n.is_group ? "font-semibold text-slate-800" : "text-slate-700"}`}>{n.name}</span>
            {!n.is_active && <span className="shrink-0 rounded bg-slate-200 px-1.5 text-[10px] uppercase text-slate-500">inactive</span>}
            {!n.is_group && exs.map((e) => <span key={e.key} className="ml-2 shrink-0 text-xs text-slate-500">{e.label}: <b className="tabular-nums">{Number(n[e.key] ?? 0).toLocaleString()}</b></span>)}
            <span className="ml-auto flex shrink-0 gap-2 text-xs">
              <button onClick={() => rename(n)} className="text-brand hover:underline">Rename</button>
              {rateEditor && !n.is_group && <button onClick={() => setRatesFor(n)} className="text-brand hover:underline">Rates</button>}
              {!n.is_group && exs.map((e) => <button key={e.key} onClick={() => setExtra(n, e)} className="text-brand hover:underline">{e.label}</button>)}
              <button onClick={() => supabase.from(table).update({ is_active: !n.is_active }).eq("id", n.id).then(() => router.refresh())} className="text-slate-500 hover:underline">{n.is_active ? "Disable" : "Enable"}</button>
              <button onClick={() => del(n)} className="text-danger hover:underline">Delete</button>
            </span>
          </div>
        </div>
        {n.is_group && isOpen && kids.map((k) => <Row key={k.id} n={k} depth={depth + 1} />)}
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];
  return (
    <div className="space-y-4">
      {note && <p className="text-sm text-slate-500">{note}</p>}
      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2"><label className="label">Name *</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Under group</label>
          <select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— top level —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></div>
        {!isGroup && exs.map((e) => (
          <div key={e.key} className="sm:col-span-1"><label className="label">{e.label}</label>
            <input className="input" type="number" step="any" value={extraVals[e.key] ?? ""} onChange={(ev) => setExtraVals((o) => ({ ...o, [e.key]: ev.target.value }))} /></div>
        ))}
        <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} /> Is a group</label></div>
        <div className="flex items-end sm:col-span-1"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
        {err && <p className="text-sm text-red-600 sm:col-span-6">{err}</p>}
      </form>
      <div className="card p-0 text-sm">
        {roots.length === 0 ? <p className="p-4 text-slate-400">Nothing yet.</p> : roots.map((n) => <Row key={n.id} n={n} depth={0} />)}
      </div>
      {ratesFor && <ProductRatesModal productId={ratesFor.id} productName={ratesFor.name} onClose={() => setRatesFor(null)} />}
    </div>
  );
}
