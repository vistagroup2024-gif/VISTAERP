"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { yearSA } from "@/lib/saudiTime";
import { splitAnnual, MONTH_LABELS } from "@/lib/monthlySplit";
import ProductRatesModal from "./ProductRatesModal";
import { useDocRights } from "@/components/AccessProvider";
import SearchSelect from "@/components/ui/SearchSelect";

// Three masters share this component; the Access tab names them separately, so
// the screen whose rights apply is the one whose table is being edited.
const TABLE_DOC: Record<string, string> = {
  acct_products: "product_tree",
  acct_cost_centers: "cost_centers",
  acct_tag_areas: "tag_areas",
};

type Node = { id: string; parent_id: string | null; name: string; is_group: boolean; is_active: boolean; sort: number; cost_center_id?: string | null; [k: string]: any };
// `type` defaults to "number" (Product Tree rates, Cost Centre's Sales
// Target); "date" is for a compliance-style expiry field (Tag Area's Car
// Authorization / Insurance / Operation Card / Fahas) — stored and shown as
// the raw date string, never coerced through Number().
type Extra = { key: string; label: string; type?: "number" | "date" };
type CostCenterOpt = { id: string; name: string };

// Reusable hierarchical master: Product Tree, Cost Center, Tag Area.
//
// IT IS THE CHART OF ACCOUNTS SCREEN, minus the things only an account has.
// Everything the chart's toolbar does, this does, in the same place and with
// the same words — Add / Add Group, Edit, Move to group, the ⤒ ↑ ↓ ⤓ ordering
// buttons, Delete, tick-several-and-move, Expand / Collapse all, Print, a
// search box and a frozen header. Only "Make a Party" and "Party Details" are
// left out, because a product is not a customer. `Rates` is the one thing here
// that the chart has no equivalent of.
//
// THERE IS ONE ADD BUTTON. There used to be two — a green submit on an inline
// form above the tree AND "+ Add" in the toolbar — which also meant the Name
// and Under-group fields sat on screen the whole time whether or not anything
// was being added. The toolbar button opens a dialog and asks for them there,
// so the fields exist only while they are wanted, and only one button adds.
//
// THE HEADER IS FROZEN two ways over, because the two do different jobs: the
// toolbar and search row are `sticky` so they survive the PAGE scrolling, and
// the tree has its own capped scroll box so the long list scrolls under a
// toolbar that never moves. The column strip inside that box is sticky too.
//
// THE ROWS ARE FLATTENED RATHER THAN RECURSED, and that is not a style choice.
// A <Row> component declared inside this one is a new function on every render,
// so React unmounts the whole tree and mounts it again; for the instant the
// rows are gone the scroll box has nothing in it, the browser clamps scrollTop
// to 0, and the list JUMPS TO THE TOP every time a checkbox is ticked. The
// Chart of Accounts hit exactly this and says so in its own comment. Nothing
// remounts here now.
export default function TreeMaster({ table, initial, extra, extras, note, rateEditor, costCenters, targetsEditor }: {
  table: string; initial: Node[]; extra?: Extra; extras?: Extra[]; note?: string; rateEditor?: boolean;
  // Which cost centre a GROUP belongs to — offered only where the caller
  // passes this in (Product Tree today), so a voucher can later narrow its
  // item picker to what is actually under the cost centre it was given.
  costCenters?: CostCenterOpt[];
  // Cost Centre's own screen only: a leaf cost centre's Edit dialog grows a
  // second "Targets" tab — the month-wise sales target
  // (acct_cost_center_monthly_targets) that used to be a separate grid on the
  // whole-company Targets & Budget screen, moved here so a target is edited
  // where the cost centre itself is, not on a screen of its own.
  targetsEditor?: boolean;
}) {
  const rights = useDocRights(TABLE_DOC[table] ?? "");
  const router = useRouter();
  const supabase = createClient();
  const exs = useMemo<Extra[]>(() => extras ?? (extra ? [extra] : []), [extras, extra]);

  const [ratesFor, setRatesFor] = useState<Node | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<{ isGroup: boolean; parent: string } | null>(null);
  const [editing, setEditing] = useState<Node | null>(null);
  const [moving, setMoving] = useState<Node | null>(null);
  const [movingMany, setMovingMany] = useState(false);

  const byId = useMemo(() => new Map(initial.map((n) => [n.id, n])), [initial]);
  const selNode = sel ? byId.get(sel) ?? null : null;
  const groups = useMemo(() => initial.filter((n) => n.is_group), [initial]);

  const byParent = useMemo(() => {
    const m = new Map<string | null, Node[]>();
    for (const n of initial) { const k = n.parent_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(n); }
    // `sort` first, name second — same shape as the chart, where everything
    // starts at 0 and a tree nobody has reordered still reads alphabetically.
    m.forEach((arr) => arr.sort((a, b) => (Number(a.sort ?? 0) - Number(b.sort ?? 0)) || a.name.localeCompare(b.name)));
    return m;
  }, [initial]);

  const descendants = useCallback((id: string): Set<string> => {
    const out = new Set<string>(); const stack = [id];
    while (stack.length) { const c = stack.pop()!; for (const k of byParent.get(c) ?? []) { out.add(k.id); stack.push(k.id); } }
    return out;
  }, [byParent]);

  // A search keeps what it matched plus every ancestor, so a hit deep in the
  // tree is shown in its place rather than stranded at the root.
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    const keep = new Set<string>();
    for (const n of initial) {
      if (n.name.toLowerCase().includes(needle)) {
        keep.add(n.id);
        let p = n.parent_id;
        while (p && !keep.has(p)) { keep.add(p); p = byId.get(p)?.parent_id ?? null; }
      }
    }
    return keep;
  }, [q, initial, byId]);

  const roots = byParent.get(null) ?? [];
  const flat = useMemo(() => {
    const out: { n: Node; depth: number }[] = [];
    const walk = (list: Node[], depth: number) => {
      for (const n of list) {
        if (visible && !visible.has(n.id)) continue;
        out.push({ n, depth });
        const kids = byParent.get(n.id) ?? [];
        const open = visible ? true : !collapsed.has(n.id);
        if (open && kids.length) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, byParent, collapsed, visible]);

  async function add(f: { name: string; parent: string; isGroup: boolean; extras: Record<string, string>; costCenterId?: string }) {
    setBusy(true); setErr(null);
    const payload: any = { company_id: COMPANY_ID, name: f.name.trim(), parent_id: f.parent || null, is_group: f.isGroup };
    if (!f.isGroup) for (const ex of exs) payload[ex.key] = ex.type === "date" ? (f.extras[ex.key] || null) : (f.extras[ex.key] ? Number(f.extras[ex.key]) : 0);
    if (costCenters && f.isGroup) payload.cost_center_id = f.costCenterId || null;
    const { error } = await supabase.from(table).insert(payload);
    setBusy(false);
    if (error) return setErr(error.message);
    setAdding(null); router.refresh();
  }

  async function saveEdit(f: { name: string; active: boolean; extras: Record<string, string>; costCenterId?: string }) {
    if (!editing) return;
    setBusy(true); setErr(null);
    const patch: any = { name: f.name.trim(), is_active: f.active };
    if (!editing.is_group) for (const ex of exs) patch[ex.key] = ex.type === "date" ? (f.extras[ex.key] || null) : (f.extras[ex.key] ? Number(f.extras[ex.key]) : 0);
    if (costCenters && editing.is_group) patch.cost_center_id = f.costCenterId || null;
    const { error } = await supabase.from(table).update(patch).eq("id", editing.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setEditing(null); router.refresh();
  }

  async function moveInto(ids: string[], target: string) {
    if (ids.length === 0) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from(table).update({ parent_id: target || null }).in("id", ids);
    setBusy(false);
    if (error) return setErr(error.message);
    setMoving(null); setMovingMany(false); setChecked(new Set()); router.refresh();
  }

  // Order WITHIN the group it already sits in — the same four buttons as the
  // chart, through master_reorder, which rebuilds the whole sibling list in one
  // transaction and carries this screen's own edit right.
  async function reorder(dir: "up" | "down" | "top" | "bottom") {
    if (!selNode) return;
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("master_reorder", { p_table: table, p_node: selNode.id, p_dir: dir });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as any;
    // "already first" is worth saying out loud; a button that silently does
    // nothing reads as a broken button.
    if (r && r.moved === false) setErr(`${selNode.name} is ${r.reason}.`);
    router.refresh();
  }

  async function del(n: Node) {
    if ((byParent.get(n.id)?.length ?? 0) > 0) return setErr(`"${n.name}" has children — remove or move them first.`);
    if (!confirm(`Delete "${n.name}"? This cannot be undone.`)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from(table).delete().eq("id", n.id);
    setBusy(false);
    if (error) return setErr(error.message);
    setSel(null); router.refresh();
  }

  // Groups eligible as a move target: never one of the rows being moved, and
  // never anything inside one of them — that would cut the subtree off.
  const targetsFor = useCallback((nodes: Node[]) => {
    const blocked = new Set<string>();
    for (const n of nodes) { blocked.add(n.id); descendants(n.id).forEach((d) => blocked.add(d)); }
    return groups.filter((g) => !blocked.has(g.id));
  }, [groups, descendants]);
  const moveTargets = useMemo(() => (moving ? targetsFor([moving]) : []), [moving, targetsFor]);
  const checkedNodes = useMemo(() => initial.filter((n) => checked.has(n.id)), [initial, checked]);
  const manyTargets = useMemo(() => targetsFor(checkedNodes), [checkedNodes, targetsFor]);

  const btn = "btn-outline btn-sm disabled:opacity-40";
  const startAdd = (isGroup: boolean) =>
    setAdding({ isGroup, parent: (selNode ? (selNode.is_group ? selNode.id : selNode.parent_id) : "") ?? "" });

  return (
    <div className="space-y-4">
      {note && <p className="no-print text-sm text-slate-500">{note}</p>}

      <div className="card p-0 text-sm">
        {/* Master toolbar. Sticky so the page scrolling cannot take it away. */}
        <div className="no-print sticky top-0 z-20 flex flex-wrap items-center gap-1.5 rounded-t-lg border-b border-slate-200 bg-white p-2">
          <button onClick={() => startAdd(false)} disabled={!rights.canCreate} title={rights.denied("create")} className={btn}>+ Add</button>
          <button onClick={() => startAdd(true)} disabled={!rights.canCreate} title={rights.denied("create")} className={btn}>+ Add Group</button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button onClick={() => selNode && setEditing(selNode)} disabled={!selNode || !rights.canEdit} title={rights.denied("edit")} className={btn}>Edit</button>
          <button onClick={() => selNode && setMoving(selNode)} disabled={!selNode || !rights.canEdit} title={rights.denied("edit")} className={btn}>Move to group</button>
          {/* Order within the group it is already in. */}
          <span className="inline-flex overflow-hidden rounded border border-slate-200">
            {([["top", "⤒", "Move to the top of its group"],
               ["up", "↑", "Move up one"],
               ["down", "↓", "Move down one"],
               ["bottom", "⤓", "Move to the bottom of its group"]] as const).map(([d, sym, tip]) => (
              <button key={d} onClick={() => reorder(d)} disabled={!selNode || busy || !rights.canEdit}
                title={rights.canEdit ? tip : rights.denied("edit")}
                className="border-r border-slate-200 px-2 py-1 text-sm text-slate-600 last:border-r-0 hover:bg-slate-50 disabled:opacity-40">
                {sym}
              </button>
            ))}
          </span>
          {rateEditor && (
            <button onClick={() => selNode && !selNode.is_group && setRatesFor(selNode)}
              disabled={!selNode || selNode.is_group || !rights.canEdit}
              title={selNode?.is_group ? "Rates belong to an item, not a group" : rights.denied("edit")}
              className={btn}>Rates</button>
          )}
          <button onClick={() => selNode && del(selNode)} disabled={!selNode || busy || !rights.canDelete} title={rights.denied("delete")} className={`${btn} text-danger`}>Delete</button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button onClick={() => setMovingMany(true)} disabled={checked.size === 0 || !rights.canEdit}
            title={checked.size === 0 ? "Tick the rows you want to move" : rights.denied("edit")}
            className={btn}>Move {checked.size || ""} selected</button>
          {checked.size > 0 && <button onClick={() => setChecked(new Set())} className={btn}>Clear ticks</button>}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button onClick={() => setCollapsed(new Set())} className={btn}>Expand all</button>
          <button onClick={() => setCollapsed(new Set(groups.map((g) => g.id)))} className={btn}>Collapse all</button>
          <button onClick={() => window.print()} disabled={!rights.canPrint} title={rights.denied("print")} className={btn}>Print</button>
          <span className="ml-auto max-w-[40%] truncate text-xs text-slate-400">
            {checked.size > 0 ? <><b className="text-slate-600">{checked.size}</b> ticked</>
              : selNode ? <>Selected: <b className="text-slate-600">{selNode.name}</b></> : `${initial.length} rows`}
          </span>
        </div>

        <div className="no-print sticky top-[52px] z-10 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-3">
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search name…" className="input max-w-xs" />
          {err && <span className="text-xs text-danger">{err}</span>}
        </div>

        <div className="max-h-[70vh] overflow-auto [--tree-indent:11px] sm:[--tree-indent:18px]">
          <div className="sticky top-0 z-10 hidden items-center gap-2 border-b border-slate-200 bg-slate-50 py-2 pl-2 pr-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:flex">
            <span className="w-4" /><span className="w-4" /><span className="flex-1">Name</span>
            {exs.map((ex) => <span key={ex.key} className="w-32 text-right">{ex.label}</span>)}
          </div>
          {flat.map(({ n, depth }) => {
            const kids = byParent.get(n.id) ?? [];
            const isOpen = visible ? true : !collapsed.has(n.id);
            const isSel = sel === n.id;
            const groupBg = n.is_group ? (depth === 0 ? "bg-slate-100" : depth === 1 ? "bg-slate-50" : "bg-slate-50/60") : "";
            return (
              <div key={n.id} className={`group flex items-stretch border-b border-slate-100 ${isSel ? "bg-brand-100 ring-1 ring-inset ring-brand-300" : `hover:bg-brand-50/40 ${groupBg}`}`}>
                {Array.from({ length: depth }).map((_, i) => (
                  <span key={i} className="shrink-0 border-l border-slate-400" style={{ width: "var(--tree-indent, 18px)" }} />
                ))}
                <label className="flex shrink-0 cursor-pointer items-center pl-1" onClick={(e) => e.stopPropagation()}
                       title="Tick to move several at once">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={checked.has(n.id)}
                    onChange={(e) => setChecked((c) => {
                      const next = new Set(c);
                      if (e.target.checked) next.add(n.id); else next.delete(n.id);
                      return next;
                    })} />
                </label>
                <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 pl-1 pr-2 sm:gap-2 sm:pr-3" onClick={() => setSel(n.id)}>
                  {n.is_group && kids.length > 0 ? (
                    <button onClick={(e) => { e.stopPropagation(); setCollapsed((c) => { const s = new Set(c); if (s.has(n.id)) s.delete(n.id); else s.add(n.id); return s; }); }}
                      className="w-4 shrink-0 text-slate-400 hover:text-slate-700" aria-label={isOpen ? "Collapse" : "Expand"}>
                      {isOpen ? "▾" : "▸"}
                    </button>
                  ) : <span className="w-4 shrink-0" />}
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
                    {n.name}
                    {!n.is_active && <span className="ml-2 rounded bg-slate-200 px-1.5 text-[10px] uppercase text-slate-500">inactive</span>}
                  </span>
                  {!n.is_group && exs.map((ex) => (
                    <span key={ex.key} className="w-32 shrink-0 text-right tabular-nums text-xs">
                      {ex.type === "date" ? (n[ex.key] ?? "—") : Number(n[ex.key] ?? 0).toLocaleString()}
                    </span>
                  ))}
                  {n.is_group && exs.map((ex) => <span key={ex.key} className="w-32 shrink-0" />)}
                </div>
              </div>
            );
          })}
          {flat.length === 0 && <div className="p-6 text-center text-slate-400">{q ? "Nothing matches that." : "Nothing yet."}</div>}
        </div>
      </div>

      {adding && (
        <AddModal isGroup={adding.isGroup} parent={adding.parent} groups={groups} exs={exs} busy={busy} costCenters={costCenters}
          onCancel={() => setAdding(null)} onSave={add} />
      )}
      {editing && (
        <EditModal node={editing} exs={exs} busy={busy} costCenters={costCenters} targetsEditor={targetsEditor}
          onCancel={() => setEditing(null)} onSave={saveEdit} />
      )}
      {moving && (
        <MoveModal title={`Move · ${moving.name}`} current={moving.parent_id ?? ""} targets={moveTargets} busy={busy}
          onCancel={() => setMoving(null)} onMove={(t) => moveInto([moving.id], t)} />
      )}
      {movingMany && (
        <MoveModal title={`Move ${checkedNodes.length} row(s)`} current="" targets={manyTargets} busy={busy}
          onCancel={() => setMovingMany(false)} onMove={(t) => moveInto(checkedNodes.map((n) => n.id), t)}>
          <p className="mb-3 max-h-32 overflow-auto text-xs text-slate-500">
            {checkedNodes.map((n) => n.name).join(", ")}
          </p>
        </MoveModal>
      )}
      {ratesFor && <ProductRatesModal productId={ratesFor.id} productName={ratesFor.name} onClose={() => setRatesFor(null)} />}
    </div>
  );
}

// The only place a new row is named. There is no second copy of these fields
// sitting above the tree any more.
function AddModal({ isGroup: initGroup, parent: initParent, groups, exs, busy, costCenters, onCancel, onSave }: {
  isGroup: boolean; parent: string; groups: Node[]; exs: Extra[]; busy: boolean; costCenters?: CostCenterOpt[];
  onCancel: () => void;
  onSave: (f: { name: string; parent: string; isGroup: boolean; extras: Record<string, string>; costCenterId?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState(initParent);
  const [isGroup, setIsGroup] = useState(initGroup);
  const [ex, setEx] = useState<Record<string, string>>({});
  const [costCenterId, setCostCenterId] = useState("");
  const save = () => onSave({ name, parent, isGroup, extras: ex, costCenterId });
  return (
    <Modal title={isGroup ? "New group" : "New item"} onClose={onCancel}>
      <label className="label">Name *</label>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) save(); }} />
      <div className="mt-3">
        <label className="label">Under group</label>
        <SearchSelect value={parent} onChange={setParent} placeholder="— top level —"
          options={groups.map((g) => ({ value: g.id, label: g.name }))} />
      </div>
      {!isGroup && exs.map((e) => (
        <div key={e.key} className="mt-3"><label className="label">{e.label}</label>
          {e.type === "date" ? (
            <input className="input" type="date" value={ex[e.key] ?? ""}
              onChange={(v) => setEx((o) => ({ ...o, [e.key]: v.target.value }))} />
          ) : (
            <input className="input" type="number" step="any" value={ex[e.key] ?? ""}
              onChange={(v) => setEx((o) => ({ ...o, [e.key]: v.target.value }))} />
          )}</div>
      ))}
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={isGroup} onChange={(e) => setIsGroup(e.target.checked)} /> Is a group
      </label>
      {costCenters && isGroup && (
        <div className="mt-3">
          <label className="label">Cost Centre</label>
          <SearchSelect value={costCenterId} onChange={setCostCenterId} placeholder="— none —"
            options={costCenters.map((c) => ({ value: c.id, label: c.name }))} />
          <p className="mt-1 text-xs text-slate-400">Everything under this group belongs to that cost centre, unless a group beneath it says otherwise.</p>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        <button onClick={save} disabled={busy || !name.trim()} className="btn">
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </Modal>
  );
}

function EditModal({ node, exs, busy, costCenters, targetsEditor, onCancel, onSave }: {
  node: Node; exs: Extra[]; busy: boolean; costCenters?: CostCenterOpt[]; targetsEditor?: boolean;
  onCancel: () => void; onSave: (f: { name: string; active: boolean; extras: Record<string, string>; costCenterId?: string }) => void;
}) {
  const [name, setName] = useState(node.name);
  const [active, setActive] = useState(node.is_active);
  const [ex, setEx] = useState<Record<string, string>>(Object.fromEntries(exs.map((e) => [e.key, node[e.key] == null ? "" : String(node[e.key])])));
  const [costCenterId, setCostCenterId] = useState(node.cost_center_id ?? "");
  // Targets only exists once the cost centre is a real, saved leaf row — a
  // group's own "target" is whatever its leaves add up to, and there is
  // nothing to point a fresh Add-dialog row at yet, so this tab is Edit-only.
  const showTargetsTab = !!targetsEditor && !node.is_group;
  const [tab, setTab] = useState<"details" | "targets">("details");
  return (
    <Modal title={`Edit · ${node.name}`} onClose={onCancel} wide={tab === "targets"}>
      {showTargetsTab && (
        <div className="mb-4 flex gap-1 border-b border-slate-200">
          {([["details", "Details"], ["targets", "Targets"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-sm ${tab === id ? "border-x border-t border-slate-200 rounded-t bg-white font-semibold text-brand" : "text-slate-500"}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      {tab === "targets" && showTargetsTab ? (
        <>
          <CostCenterTargetsTab costCenterId={node.id} />
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onCancel} className="btn-outline">Close</button>
          </div>
        </>
      ) : (
        <>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {!node.is_group && exs.map((e) => (
            <div key={e.key} className="mt-3"><label className="label">{e.label}</label>
              {e.type === "date" ? (
                <input className="input" type="date" value={ex[e.key] ?? ""} onChange={(v) => setEx((o) => ({ ...o, [e.key]: v.target.value }))} />
              ) : (
                <input className="input" type="number" step="any" value={ex[e.key] ?? ""} onChange={(v) => setEx((o) => ({ ...o, [e.key]: v.target.value }))} />
              )}</div>
          ))}
          {costCenters && node.is_group && (
            <div className="mt-3">
              <label className="label">Cost Centre</label>
              <SearchSelect value={costCenterId} onChange={setCostCenterId} placeholder="— none —"
                options={costCenters.map((c) => ({ value: c.id, label: c.name }))} />
              <p className="mt-1 text-xs text-slate-400">Everything under this group belongs to that cost centre, unless a group beneath it says otherwise.</p>
            </div>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={onCancel} className="btn-outline">Cancel</button>
            <button onClick={() => onSave({ name, active, extras: ex, costCenterId })} disabled={busy || !name.trim()} className="btn">{busy ? "Saving…" : "Save"}</button>
          </div>
        </>
      )}
    </Modal>
  );
}

// One cost centre's own month-wise sales target
// (acct_cost_center_monthly_targets) — report_cost_center_targets(),
// report_cost_centre_costing() and report_sales() all sum this same table
// over whichever months their period covers, so a figure typed here reaches
// every one of them without a second table to keep in step. Each month
// saves itself on blur, exactly like the old whole-company grid did; Annual
// only SEEDS the twelve months (splitAnnual — eleven equal, the twelfth
// carrying the rounding remainder so they sum back exactly) and still has to
// be applied, after which every month stays individually hand-editable.
function CostCenterTargetsTab({ costCenterId }: { costCenterId: string }) {
  const supabase = createClient();
  const thisYear = yearSA();
  const [year, setYear] = useState(thisYear);
  const [months, setMonths] = useState<Record<number, number>>({});
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [annual, setAnnual] = useState("");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("acct_cost_center_monthly_targets")
      .select("month, target").eq("company_id", COMPANY_ID).eq("cost_center_id", costCenterId).eq("year", year);
    const m: Record<number, number> = {};
    for (const r of (data as any[]) ?? []) m[r.month] = Number(r.target);
    setMonths(m); setDraft({}); setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [costCenterId, year]);
  useEffect(() => { load(); }, [load]);

  async function saveMonth(month: number) {
    const v = draft[month];
    if (v === undefined) return;
    await supabase.from("acct_cost_center_monthly_targets").upsert(
      { company_id: COMPANY_ID, cost_center_id: costCenterId, year, month, target: Number(v) || 0 },
      { onConflict: "company_id,cost_center_id,year,month" });
    load();
  }
  async function applyAnnual() {
    const a = Number(annual);
    if (!annual.trim() || isNaN(a)) return;
    setApplying(true);
    const split = splitAnnual(a);
    const rows = split.map((amount, i) => ({ company_id: COMPANY_ID, cost_center_id: costCenterId, year, month: i + 1, target: amount }));
    await supabase.from("acct_cost_center_monthly_targets").upsert(rows, { onConflict: "company_id,cost_center_id,year,month" });
    setApplying(false); setAnnual(""); load();
  }
  const total = MONTH_LABELS.reduce((s, _, i) => s + Number(draft[i + 1] ?? months[i + 1] ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">Year</label><input type="number" className="input w-24" value={year} onChange={(e) => setYear(Number(e.target.value) || thisYear)} /></div>
        <div>
          <label className="label">Annual — splits into the 12 months below</label>
          <div className="flex gap-1">
            <input className="input w-32 text-right tabular-nums" inputMode="decimal" placeholder="0.00"
              value={annual} onChange={(e) => setAnnual(e.target.value)} />
            <button onClick={applyAnnual} disabled={applying || !annual.trim()} className="btn-outline btn-sm">{applying ? "…" : "Apply"}</button>
          </div>
        </div>
      </div>
      {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MONTH_LABELS.map((label, i) => {
            const month = i + 1;
            return (
              <div key={month}>
                <label className="label">{label}-{String(year).slice(-2)}</label>
                <input className="input text-right tabular-nums" inputMode="decimal"
                  value={draft[month] ?? String(Number(months[month] ?? 0))}
                  onChange={(e) => setDraft((d) => ({ ...d, [month]: e.target.value }))}
                  onBlur={() => saveMonth(month)} />
              </div>
            );
          })}
        </div>
      )}
      <p className="text-right text-sm font-semibold text-slate-700">Total: <span className="tabular-nums">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
    </div>
  );
}

// One dialog for both "move this" and "move the ticked ones" — they differ only
// in the title and in whether a current parent is pre-selected.
function MoveModal({ title, current, targets, busy, onCancel, onMove, children }: {
  title: string; current: string; targets: Node[]; busy: boolean;
  onCancel: () => void; onMove: (target: string) => void; children?: React.ReactNode;
}) {
  const [target, setTarget] = useState<string>(current);
  return (
    <Modal title={title} onClose={onCancel}>
      {children}
      <label className="label">New parent group</label>
      <SearchSelect value={target} onChange={setTarget} placeholder="— top level —" options={targets.map((g) => ({ value: g.id, label: g.name }))} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        <button onClick={() => onMove(target)} disabled={busy} className="btn">{busy ? "Moving…" : "Move"}</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative w-full rounded-lg border border-slate-200 bg-white p-5 shadow-pop ${wide ? "max-w-lg" : "max-w-md"}`}>
        <h3 className="mb-4 text-sm font-semibold text-slate-800">{title}</h3>
        {children}
      </div>
    </div>
  );
}
