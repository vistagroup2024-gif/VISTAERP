"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import ProductRatesModal from "./ProductRatesModal";

type Node = { id: string; parent_id: string | null; name: string; is_group: boolean; is_active: boolean; sort: number; [k: string]: any };
type Extra = { key: string; label: string };

// Reusable hierarchical master (Product Tree, Cost Center, Tag Area). Groups +
// items, optional numeric `extra` field(s) on item rows, and a master toolbar
// (Add / Add Group / Edit / Move / Delete / Print) that acts on the selected row
// — the same interaction as the Chart of Accounts.
export default function TreeMaster({ table, initial, extra, extras, note, rateEditor }: {
  table: string; initial: Node[]; extra?: Extra; extras?: Extra[]; note?: string; rateEditor?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const exs = useMemo<Extra[]>(() => extras ?? (extra ? [extra] : []), [extras, extra]);
  const nameRef = useRef<HTMLInputElement>(null);

  const [ratesFor, setRatesFor] = useState<Node | null>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [isGroup, setIsGroup] = useState(true);
  const [extraVals, setExtraVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<Node | null>(null);
  const [moving, setMoving] = useState<Node | null>(null);

  const byId = useMemo(() => new Map(initial.map((n) => [n.id, n])), [initial]);
  const selNode = sel ? byId.get(sel) ?? null : null;
  const groups = useMemo(() => initial.filter((n) => n.is_group), [initial]);
  const byParent = useMemo(() => {
    const m = new Map<string | null, Node[]>();
    for (const n of initial) { const k = n.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(n); }
    m.forEach((arr) => arr.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
    return m;
  }, [initial]);

  function descendants(id: string): Set<string> {
    const out = new Set<string>(); const stack = [id];
    while (stack.length) { const c = stack.pop()!; for (const k of byParent.get(c) ?? []) { out.add(k.id); stack.push(k.id); } }
    return out;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!name.trim()) return setErr("Name is required");
    setBusy(true);
    const payload: any = { company_id: COMPANY_ID, name: name.trim(), parent_id: parent || null, is_group: isGroup };
    if (!isGroup) for (const ex of exs) payload[ex.key] = extraVals[ex.key] ? Number(extraVals[ex.key]) : 0;
    const { error } = await supabase.from(table).insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    setName(""); setExtraVals({}); router.refresh();
  }

  // Toolbar "Add" / "Add Group": pre-fill the form's parent from the selection
  // and focus it, so a sub-node lands under the right group.
  function startAdd(asGroup: boolean) {
    const p = selNode ? (selNode.is_group ? selNode.id : selNode.parent_id) : "";
    setParent(p ?? ""); setIsGroup(asGroup); setErr(null);
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  async function saveEdit(f: { name: string; active: boolean; extras: Record<string, string> }) {
    if (!editing) return;
    setBusy(true); setErr(null);
    const patch: any = { name: f.name.trim(), is_active: f.active };
    if (!editing.is_group) for (const ex of exs) patch[ex.key] = f.extras[ex.key] ? Number(f.extras[ex.key]) : 0;
    const { error } = await supabase.from(table).update(patch).eq("id", editing.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditing(null); router.refresh();
  }

  async function move(target: string) {
    if (!moving) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from(table).update({ parent_id: target || null }).eq("id", moving.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setMoving(null); router.refresh();
  }

  async function del(n: Node) {
    if ((byParent.get(n.id)?.length ?? 0) > 0) return setErr(`"${n.name}" has children — remove them first.`);
    if (!confirm(`Delete "${n.name}"?`)) return;
    const { error } = await supabase.from(table).delete().eq("id", n.id);
    if (error) return setErr(error.message);
    setSel(null); router.refresh();
  }

  const moveTargets = useMemo(() => {
    if (!moving) return [];
    const blocked = descendants(moving.id); blocked.add(moving.id);
    return groups.filter((g) => !blocked.has(g.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moving, groups, byParent]);

  function Row({ n, depth }: { n: Node; depth: number }) {
    const kids = byParent.get(n.id) ?? [];
    const isOpen = open[n.id] ?? true;
    const isSel = sel === n.id;
    const groupBg = n.is_group ? (depth === 0 ? "bg-slate-100" : depth === 1 ? "bg-slate-50" : "bg-slate-50/60") : "";
    return (
      <div>
        <div className={`group flex items-stretch border-b border-slate-100 ${isSel ? "bg-brand-100 ring-1 ring-inset ring-brand-300" : `hover:bg-brand-50/40 ${groupBg}`}`}>
          {Array.from({ length: depth }).map((_, i) => (
            <span key={i} className="shrink-0 border-l border-slate-400" style={{ width: 18 }} />
          ))}
          <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pl-1 pr-3" onClick={() => setSel(n.id)}>
            {n.is_group && kids.length > 0
              ? <button onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [n.id]: !isOpen })); }} className="w-4 shrink-0 text-slate-400 hover:text-slate-700">{isOpen ? "▾" : "▸"}</button>
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
            {!n.is_group && exs.map((ex) => <span key={ex.key} className="ml-2 shrink-0 text-xs text-slate-500">{ex.label}: <b className="tabular-nums">{Number(n[ex.key] ?? 0).toLocaleString()}</b></span>)}
          </div>
        </div>
        {n.is_group && isOpen && kids.map((k) => <Row key={k.id} n={k} depth={depth + 1} />)}
      </div>
    );
  }

  const roots = byParent.get(null) ?? [];
  const btn = "btn-outline btn-sm disabled:opacity-40";

  return (
    <div className="space-y-4">
      {note && <p className="text-sm text-slate-500">{note}</p>}

      <form onSubmit={add} className="card grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2"><label className="label">Name *</label>
          <input ref={nameRef} className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Under group</label>
          <select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">— top level —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></div>
        {!isGroup && exs.map((ex) => (
          <div key={ex.key} className="sm:col-span-1"><label className="label">{ex.label}</label>
            <input className="input" type="number" step="any" value={extraVals[ex.key] ?? ""} onChange={(ev) => setExtraVals((o) => ({ ...o, [ex.key]: ev.target.value }))} /></div>
        ))}
        <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} /> Is a group</label></div>
        <div className="flex items-end sm:col-span-1"><button className="btn w-full" disabled={busy}>{busy ? "…" : "+ Add"}</button></div>
        {err && <p className="text-sm text-danger sm:col-span-6">{err}</p>}
      </form>

      <div className="card p-0 text-sm">
        {/* Master toolbar */}
        <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-slate-200 p-2">
          <button onClick={() => startAdd(false)} className={btn}>+ Add</button>
          <button onClick={() => startAdd(true)} className={btn}>+ Add Group</button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button onClick={() => selNode && setEditing(selNode)} disabled={!selNode} className={btn}>Edit</button>
          <button onClick={() => selNode && setMoving(selNode)} disabled={!selNode} className={btn}>Move</button>
          {rateEditor && <button onClick={() => selNode && !selNode.is_group && setRatesFor(selNode)} disabled={!selNode || selNode.is_group} className={btn}>Rates</button>}
          <button onClick={() => selNode && del(selNode)} disabled={!selNode} className={`${btn} text-danger`}>Delete</button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button onClick={() => setOpen({})} className={btn}>Expand all</button>
          <button onClick={() => setOpen(Object.fromEntries(groups.map((g) => [g.id, false])))} className={btn}>Collapse all</button>
          <button onClick={() => window.print()} className={btn}>Print</button>
          <span className="ml-auto max-w-[40%] truncate text-xs text-slate-400">
            {selNode ? <>Selected: <b className="text-slate-600">{selNode.name}</b></> : "Select a row to edit"}
          </span>
        </div>
        {roots.length === 0 ? <p className="p-4 text-slate-400">Nothing yet.</p> : roots.map((n) => <Row key={n.id} n={n} depth={0} />)}
      </div>

      {editing && <EditModal node={editing} exs={exs} busy={busy} onCancel={() => setEditing(null)} onSave={saveEdit} />}
      {moving && <MoveModal node={moving} targets={moveTargets} busy={busy} onCancel={() => setMoving(null)} onMove={move} />}
      {ratesFor && <ProductRatesModal productId={ratesFor.id} productName={ratesFor.name} onClose={() => setRatesFor(null)} />}
    </div>
  );
}

function EditModal({ node, exs, busy, onCancel, onSave }: {
  node: Node; exs: Extra[]; busy: boolean;
  onCancel: () => void; onSave: (f: { name: string; active: boolean; extras: Record<string, string> }) => void;
}) {
  const [name, setName] = useState(node.name);
  const [active, setActive] = useState(node.is_active);
  const [ex, setEx] = useState<Record<string, string>>(Object.fromEntries(exs.map((e) => [e.key, String(node[e.key] ?? "")])));
  return (
    <Modal title={`Edit · ${node.name}`} onClose={onCancel}>
      <label className="label">Name</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {!node.is_group && exs.map((e) => (
        <div key={e.key} className="mt-3"><label className="label">{e.label}</label>
          <input className="input" type="number" step="any" value={ex[e.key] ?? ""} onChange={(v) => setEx((o) => ({ ...o, [e.key]: v.target.value }))} /></div>
      ))}
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        <button onClick={() => onSave({ name, active, extras: ex })} disabled={busy || !name.trim()} className="btn">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

function MoveModal({ node, targets, busy, onCancel, onMove }: {
  node: Node; targets: Node[]; busy: boolean; onCancel: () => void; onMove: (target: string) => void;
}) {
  const [target, setTarget] = useState<string>(node.parent_id ?? "");
  return (
    <Modal title={`Move · ${node.name}`} onClose={onCancel}>
      <label className="label">New parent group</label>
      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">— top level —</option>
        {targets.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        <button onClick={() => onMove(target)} disabled={busy} className="btn">{busy ? "Moving…" : "Move"}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-pop">
        <h3 className="mb-4 text-sm font-semibold text-slate-800">{title}</h3>
        {children}
      </div>
    </div>
  );
}
