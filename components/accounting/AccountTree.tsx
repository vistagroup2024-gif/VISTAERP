"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { useDocRights } from "@/components/AccessProvider";
import SearchSelect from "@/components/ui/SearchSelect";

// One node as returned by the acct_tree RPC (flat list; tree built client-side).
export type AcctNode = {
  id: string; code: string; name: string; name_ar: string | null;
  nature: "asset" | "liability" | "equity" | "income" | "expense" | "control";
  is_group: boolean; is_postable: boolean; parent_id: string | null; path: string | null;
  currency: string; subtype: string | null; status: string;
  /** Where it sits among its siblings. 0 everywhere until somebody reorders. */
  sort_order?: number | null;
  /** Set when this account IS a customer, agent or supplier — the record the
   *  bookings, groups, rate charts and vouchers pick their parties from. */
  party_type: "customer" | "supplier" | "b2b_agent" | null;
  /** The party record itself, for Party Details. Null unless party_type is set. */
  party: {
    id: string; code: string | null; phone: string | null; email: string | null;
    currency: string | null; credit_limit: number | null; credit_days: number | null;
    sales_target: number | null; is_active: boolean;
  } | null;
  own_debit: number; own_credit: number;
};

const PARTY_LABEL: Record<string, string> = {
  customer: "Customer", supplier: "Supplier", b2b_agent: "B2B Agent",
};

/** A Receivable or Payable account that a voucher CANNOT pick.
 *
 *  There are two party concepts in this ERP and about thirty screens read the
 *  wrong one to notice: `parties` is what every picker offers — the trade
 *  voucher's party, Bill Record, the visa group agent, the hotel supplier, the
 *  rate master's agent list — while `accounts` is only the ledger. An account
 *  with no parties row behind it can be posted to by a Journal and is invisible
 *  to all of them.
 *
 *  Nothing said so. A sweep of the live chart found 25 Payable accounts in this
 *  state — a whole block of transport suppliers and drivers that nobody could
 *  select on a Purchase Voucher, and no error anywhere, because the name simply
 *  was not in the list. So the tree says it now, where Make a Party already is.
 *
 *  Receivable and Payable only: those are the two subtypes ensure_party_account
 *  puts a party under, and the two the pickers read. A Bank or an Expense
 *  account is not meant to be a party and must not be nagged about. */
const needsParty = (n: AcctNode) =>
  !n.is_group && n.is_postable && !n.party_type
  && (n.subtype === "Receivable" || n.subtype === "Payable");

const NATURE_BADGE: Record<string, string> = {
  asset: "bg-blue-100 text-blue-700",
  liability: "bg-amber-100 text-amber-700",
  equity: "bg-purple-100 text-purple-700",
  income: "bg-green-100 text-green-700",
  expense: "bg-red-100 text-red-700",
  control: "bg-slate-200 text-slate-600",
};
const SUBTYPES = ["Cash","Bank","Receivable","Payable","Inventory","Fixed Asset","Accumulated Depreciation","Tax","Revenue","COGS","Direct Expense","Indirect Expense","Equity","Drawing"];

function money(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}
function drcr(net: number) {
  if (Math.abs(net) < 0.005) return <span className="text-slate-300">0.00</span>;
  return (
    <span className="text-slate-800">
      {money(net)} <span className="text-[10px] font-semibold text-slate-400">{net >= 0 ? "Dr" : "Cr"}</span>
    </span>
  );
}

export default function AccountTree({ nodes }: { nodes: AcctNode[] }) {
  const rights = useDocRights("coa");
  const router = useRouter();
  const supabase = createClient();
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opErr, setOpErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<AcctNode | null>(null);
  const [moving, setMoving] = useState<AcctNode | null>(null);
  // Ticked accounts, for a move that covers more than one. Separate from `sel`
  // on purpose: `sel` is what Edit, Delete and Party Details act on, and that
  // is still one account. Reorganising a chart is the job that comes in bulk.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [movingMany, setMovingMany] = useState(false);
  const [linking, setLinking] = useState<AcctNode | null>(null);
  const [party, setParty] = useState<AcctNode | null>(null);

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selNode = sel ? byId.get(sel) ?? null : null;

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
    // sort_order first, code second. Everything starts at 0, so a chart nobody
    // has reordered still comes out in code order exactly as it always did.
    Array.from(m.values()).forEach((arr) => arr.sort((a, b) =>
      (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)) ||
      a.code.localeCompare(b.code, undefined, { numeric: true })));
    return m;
  }, [nodes]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
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
  }, [q, nodes, byId]);

  const roots = childrenOf.get(null) ?? [];

  function toggle(id: string) {
    setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── Toolbar actions ──────────────────────────────────────────────────────
  function add(asGroup: boolean) {
    const parent = selNode ? (selNode.is_group ? selNode.id : selNode.parent_id) : "";
    const p = new URLSearchParams();
    if (parent) p.set("parent", parent);
    if (asGroup) p.set("group", "1");
    router.push("/accounting/accounts/new" + (p.toString() ? `?${p}` : ""));
  }

  async function saveProps(f: { name: string; name_ar: string; subtype: string; currency: string; status: string }) {
    if (!editing) return;
    setBusy(true); setOpErr(null);
    const patch: any = { name: f.name.trim(), name_ar: f.name_ar || null, currency: f.currency, status: f.status };
    if (!editing.is_group) patch.subtype = f.subtype || null;
    const { error } = await supabase.from("accounts").update(patch).eq("id", editing.id);
    setBusy(false);
    if (error) return setOpErr(error.message);
    setEditing(null); router.refresh();
  }

  // Give an account that is already in the tree its customer / agent / supplier
  // record. Only for the ones typed in before the New Account form could do it
  // in one step; the database applies the same rules either way.
  async function doLink(partyType: string) {
    if (!linking) return;
    setBusy(true); setOpErr(null);
    const { error } = await supabase.rpc("acct_link_party", { p_account: linking.id, p_party_type: partyType });
    setBusy(false);
    if (error) return setOpErr(error.message);
    setLinking(null); router.refresh();
  }

  async function saveParty(f: PartyFields) {
    if (!party) return;
    setBusy(true); setOpErr(null);
    const { error } = await supabase.rpc("acct_party_save", {
      p_account: party.id, p_name: f.name.trim(), p_code: f.code || null,
      p_phone: f.phone || null, p_email: f.email || null, p_currency: f.currency,
      p_credit_limit: Number(f.credit_limit) || 0, p_credit_days: Number(f.credit_days) || 0,
      p_sales_target: Number(f.sales_target) || 0, p_is_active: f.is_active,
    });
    setBusy(false);
    if (error) return setOpErr(error.message);
    setParty(null); router.refresh();
  }

  // One routine for one account and for fifty. It runs in a single
  // transaction, refuses a destination that is not a group or that sits inside
  // what is being moved, and rebuilds the paths once at the end — none of which
  // the old browser-side update did.
  async function moveInto(ids: string[], target: string) {
    if (ids.length === 0) return;
    setBusy(true); setOpErr(null);
    const { error } = await supabase.rpc("acct_move_many",
      { p_accounts: ids, p_parent: target || null });
    setBusy(false);
    if (error) return setOpErr(error.message);
    setMoving(null); setMovingMany(false); setChecked(new Set()); router.refresh();
  }
  const doMove = (target: string) => moveInto(moving ? [moving.id] : [], target);

  // Moving WITHIN a group. A chart has an order as well as a shape, and this is
  // the only thing that sets it — the alternative was renumbering the account,
  // which changes the code it is known by everywhere else.
  async function reorder(dir: "up" | "down" | "top" | "bottom") {
    if (!selNode) return;
    setBusy(true); setOpErr(null);
    const { data, error } = await supabase.rpc("acct_reorder", { p_account: selNode.id, p_dir: dir });
    setBusy(false);
    if (error) return setOpErr(error.message);
    // "already first" is worth saying out loud; a button that silently does
    // nothing reads as a broken button.
    const r = data as any;
    if (r && r.moved === false) setOpErr(`${selNode.name} is ${r.reason}.`);
    router.refresh();
  }

  // Deleting goes through acct_delete rather than straight off the table: an
  // account can be a customer, agent or supplier now, and deleting one half of
  // that pair would leave a party nothing posts to. The routine does both and
  // refuses either if the account carries postings or the party is spoken for.
  async function doDelete() {
    if (!selNode) return;
    if ((childrenOf.get(selNode.id)?.length ?? 0) > 0) { setOpErr(`"${selNode.name}" has sub-accounts — remove or move them first.`); return; }
    const alsoParty = selNode.party_type ? ` It is also a ${PARTY_LABEL[selNode.party_type].toLowerCase()}, and that record goes with it.` : "";
    if (!confirm(`Delete "${selNode.name}"?${alsoParty} This cannot be undone.`)) return;
    setBusy(true); setOpErr(null);
    const { error } = await supabase.rpc("acct_delete", { p_account: selNode.id });
    setBusy(false);
    if (error) return setOpErr(error.message);
    setSel(null); router.refresh();
  }

  // Groups eligible as a move target: never one of the accounts being moved,
  // and never anything inside one of them — that would cut the subtree off the
  // chart. The database refuses it too; this keeps it out of the list.
  const targetsFor = useCallback((movingNodes: AcctNode[]) => {
    const paths = movingNodes.map((n) => n.path).filter(Boolean) as string[];
    const blocked = new Set(
      nodes.filter((n) => n.path && paths.some((p) => n.path === p || n.path!.startsWith(p + "/")))
           .map((n) => n.id));
    return nodes.filter((n) => n.is_group && !blocked.has(n.id))
                .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [nodes]);
  const moveTargets = useMemo(() => (moving ? targetsFor([moving]) : []), [moving, targetsFor]);
  const checkedNodes = useMemo(() => nodes.filter((n) => checked.has(n.id)), [nodes, checked]);
  const manyTargets = useMemo(() => targetsFor(checkedNodes), [checkedNodes, targetsFor]);

  // The tree, flattened once into the rows that are actually on screen.
  //
  // This used to be a <Row> component declared inside this one, which recursed.
  // That is what made the list JUMP TO THE TOP every time a checkbox was
  // ticked: a component declared inside a render is a NEW function on every
  // render, so React treats it as a different component type, unmounts the
  // whole tree and mounts it again. For the split second the rows are gone the
  // scroll container has nothing in it, so the browser clamps scrollTop to 0 —
  // and it stays there when the rows come back. Nothing remounts now, so the
  // scroll position is simply never disturbed.
  const flat = useMemo(() => {
    const out: { n: AcctNode; depth: number }[] = [];
    const walk = (list: AcctNode[], depth: number) => {
      for (const n of list) {
        if (visible && !visible.has(n.id)) continue;
        out.push({ n, depth });
        const kids = childrenOf.get(n.id) ?? [];
        // A search shows everything it matched, so the collapse state is
        // ignored while one is running.
        const open = visible ? true : !collapsed.has(n.id);
        if (open && kids.length) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, childrenOf, collapsed, visible]);

  const btn = "btn-outline btn-sm disabled:opacity-40";

  return (
    <div className="card p-0">
      {/* Master toolbar */}
      <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-slate-200 p-2">
        <button onClick={() => add(false)} disabled={!rights.canCreate} title={rights.denied("create")} className={btn}>+ Add</button>
        <button onClick={() => add(true)} disabled={!rights.canCreate} title={rights.denied("create")} className={btn}>+ Add Group</button>
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
        <button onClick={() => selNode && setLinking(selNode)}
          disabled={!selNode || selNode.is_group || !!selNode.party_type || !rights.canEdit}
          title={selNode?.party_type ? `Already a ${PARTY_LABEL[selNode.party_type].toLowerCase()}` : rights.denied("edit")}
          className={btn}>Make a Party</button>
        <button onClick={() => selNode && setParty(selNode)}
          disabled={!selNode || !selNode.party_type || !rights.canEdit}
          title={selNode && !selNode.party_type ? "Only a customer, agent or supplier has these" : rights.denied("edit")}
          className={btn}>Party Details</button>
        <button onClick={doDelete} disabled={!selNode || busy || !rights.canDelete} title={rights.denied("delete")} className={`${btn} text-danger`}>Delete</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={() => setMovingMany(true)} disabled={checked.size === 0 || !rights.canEdit}
          title={checked.size === 0 ? "Tick the accounts you want to move" : rights.denied("edit")}
          className={btn}>Move {checked.size || ""} selected</button>
        {checked.size > 0 && (
          <button onClick={() => setChecked(new Set())} className={btn}>Clear ticks</button>
        )}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={() => setCollapsed(new Set())} className={btn}>Expand all</button>
        <button onClick={() => setCollapsed(new Set(nodes.filter((n) => n.is_group).map((n) => n.id)))} className={btn}>Collapse all</button>
        <button onClick={() => window.print()} disabled={!rights.canPrint} title={rights.denied("print")} className={btn}>Print</button>
        <span className="ml-auto max-w-[40%] truncate text-xs text-slate-400">
          {checked.size > 0 ? <><b className="text-slate-600">{checked.size}</b> ticked</>
            : selNode ? <>Selected: <b className="text-slate-600">{selNode.name}</b></> : `${nodes.length} accounts`}
        </span>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, Arabic, type…" className="input max-w-xs" />
        {opErr && <span className="text-xs text-danger">{opErr}</span>}
      </div>

      <div className="hidden items-center gap-2 border-b border-slate-200 bg-slate-50 py-2 pr-3 pl-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:flex">
        <span className="w-4" /><span className="w-4" /><span className="flex-1">Account</span><span className="w-40 text-right">Balance</span>
      </div>
      <div className="max-h-[70vh] overflow-auto text-sm [--tree-indent:11px] sm:[--tree-indent:18px]">
        {flat.map(({ n, depth }) => {
          const kids = childrenOf.get(n.id) ?? [];
          const hasKids = kids.length > 0;
          const isOpen = visible ? true : !collapsed.has(n.id);
          const net = rollup.get(n.id) ?? 0;
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
                {hasKids ? (
                  <button onClick={(e) => { e.stopPropagation(); toggle(n.id); }} className="w-4 shrink-0 text-slate-400 hover:text-slate-700" aria-label={isOpen ? "Collapse" : "Expand"}>
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
                  {n.is_postable ? (
                    <Link href={`/accounting/ledger?account=${n.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand hover:underline">{n.name}</Link>
                  ) : n.name}
                  {n.status !== "active" && <span className="ml-2 rounded bg-slate-200 px-1.5 text-[10px] uppercase text-slate-500">{n.status}</span>}
                </span>
                {n.party_type && (
                  <span className="hidden shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 sm:inline-flex"
                        title="This account is also a party — it can be picked on bookings, groups, rate charts and vouchers">
                    {PARTY_LABEL[n.party_type]}
                  </span>
                )}
                {needsParty(n) && (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
                        title={`${n.name} is in the ledger but is not a party, so no voucher, bill or booking can pick it — only a Journal can post to it. Select it and press "Make a Party" to fix that.`}>
                    not a party
                  </span>
                )}
                {!n.is_group && <span className={`badge ${NATURE_BADGE[n.nature]} hidden shrink-0 sm:inline-flex`}>{n.subtype ?? n.nature}</span>}
                <span className={`w-20 shrink-0 text-right tabular-nums text-xs sm:w-40 sm:text-sm ${n.is_group ? "font-semibold" : ""}`}>{drcr(net)}</span>
              </div>
            </div>
          );
        })}
        {flat.length === 0 && <div className="p-6 text-center text-slate-400">No accounts.</div>}
      </div>

      {editing && <PropsModal node={editing} busy={busy} onCancel={() => setEditing(null)} onSave={saveProps} />}
      {moving && <MoveModal node={moving} targets={moveTargets} busy={busy} onCancel={() => setMoving(null)} onMove={doMove} />}
      {movingMany && (
        <MoveManyModal nodes={checkedNodes} targets={manyTargets} busy={busy}
          onCancel={() => setMovingMany(false)}
          onMove={(t) => moveInto(checkedNodes.map((n) => n.id), t)} />
      )}
      {linking && <LinkPartyModal node={linking} busy={busy} onCancel={() => setLinking(null)} onLink={doLink} />}
      {party && <PartyModal node={party} busy={busy} onCancel={() => setParty(null)} onSave={saveParty} />}
    </div>
  );
}

// ── Properties (Edit) modal ──────────────────────────────────────────────────
function PropsModal({ node, busy, onCancel, onSave }: {
  node: AcctNode; busy: boolean;
  onCancel: () => void;
  onSave: (f: { name: string; name_ar: string; subtype: string; currency: string; status: string }) => void;
}) {
  const [f, setF] = useState({
    name: node.name, name_ar: node.name_ar ?? "", subtype: node.subtype ?? "",
    currency: node.currency ?? "SAR", status: node.status ?? "active",
  });
  return (
    <Modal title={`Properties · ${node.name}`} onClose={onCancel}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Account name</label>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></div>
        <div className="sm:col-span-2"><label className="label">Name (AR)</label>
          <input className="input text-right" dir="rtl" value={f.name_ar} onChange={(e) => setF({ ...f, name_ar: e.target.value })} /></div>
        {!node.is_group && (
          <div><label className="label">Sub-type</label>
            <select className="input" value={f.subtype} onChange={(e) => setF({ ...f, subtype: e.target.value })}>
              <option value="">—</option>{SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
        )}
        <div><label className="label">Currency</label>
          <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option>SAR</option><option>PKR</option><option>USD</option><option>AED</option>
          </select></div>
        <div><label className="label">Status</label>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </select></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        <button onClick={() => onSave(f)} disabled={busy || !f.name.trim()} className="btn">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

// ── Party Details modal ──────────────────────────────────────────────────────
// The code, phone, email, credit terms, sales target and active flag that used
// to live on the Customers / Agents / Suppliers screen. The name is here rather
// than under Edit because it is the party's name as well as the account's, and
// acct_party_save writes it to both so they cannot drift apart.
export type PartyFields = {
  name: string; code: string; phone: string; email: string; currency: string;
  credit_limit: string; credit_days: string; sales_target: string; is_active: boolean;
};

function PartyModal({ node, busy, onCancel, onSave }: {
  node: AcctNode; busy: boolean; onCancel: () => void; onSave: (f: PartyFields) => void;
}) {
  const p = node.party;
  const [f, setF] = useState<PartyFields>({
    name: node.name,
    code: p?.code ?? "", phone: p?.phone ?? "", email: p?.email ?? "",
    currency: p?.currency ?? node.currency ?? "SAR",
    credit_limit: String(p?.credit_limit ?? 0),
    credit_days: String(p?.credit_days ?? 0),
    sales_target: String(p?.sales_target ?? 0),
    is_active: p?.is_active ?? true,
  });
  const set = (k: keyof PartyFields, v: any) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title={`Party Details · ${PARTY_LABEL[node.party_type ?? ""] ?? "Party"}`} onClose={onCancel}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Name</label>
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          <p className="mt-1 text-xs text-slate-400">Renames the ledger account too — one name in both places.</p></div>
        <div><label className="label">Code</label>
          <input className="input" value={f.code} onChange={(e) => set("code", e.target.value)} /></div>
        <div><label className="label">Phone</label>
          <input className="input" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Email</label>
          <input className="input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
        <div><label className="label">Currency</label>
          <select className="input" value={f.currency} onChange={(e) => set("currency", e.target.value)}>
            <option>SAR</option><option>PKR</option><option>USD</option><option>AED</option>
          </select></div>
        <div><label className="label">Credit limit</label>
          <input className="input text-right tabular-nums" inputMode="decimal" value={f.credit_limit}
            onChange={(e) => set("credit_limit", e.target.value)} /></div>
        <div><label className="label">Credit days</label>
          <input className="input text-right tabular-nums" inputMode="numeric" value={f.credit_days}
            onChange={(e) => set("credit_days", e.target.value)} /></div>
        {node.party_type !== "supplier" && (
          <div><label className="label">Sales target</label>
            <input className="input text-right tabular-nums" inputMode="decimal" value={f.sales_target}
              onChange={(e) => set("sales_target", e.target.value)} /></div>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.is_active} onChange={(e) => set("is_active", e.target.checked)} />
          Active — an inactive one is no longer offered on bookings, groups or vouchers
        </label>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        <button onClick={() => onSave(f)} disabled={busy || !f.name.trim()} className="btn">{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

// ── Make a Party modal ───────────────────────────────────────────────────────
// The account keeps its name, its place in the tree and its balance; what it
// gains is the record every booking, visa group, rate chart and voucher reads
// its customers, agents and suppliers from.
function LinkPartyModal({ node, busy, onCancel, onLink }: {
  node: AcctNode; busy: boolean; onCancel: () => void; onLink: (partyType: string) => void;
}) {
  // A supplier is a payable, a customer or an agent is a receivable — so this
  // account's sub-type already decides which of the two it can be. The database
  // refuses the mismatch; offering only what fits saves finding that out.
  const options = node.subtype === "Payable"
    ? [{ v: "supplier", l: "Supplier" }]
    : node.subtype === "Receivable"
      ? [{ v: "customer", l: "Customer" }, { v: "b2b_agent", l: "B2B Agent" }]
      : [];
  const [choice, setChoice] = useState(options[0]?.v ?? "");
  return (
    <Modal title={`Make a Party · ${node.name}`} onClose={onCancel}>
      {options.length === 0 ? (
        <p className="text-sm text-slate-600">
          Only a <b>Receivable</b> or <b>Payable</b> account can be a party, and this one is{" "}
          <b>{node.subtype || "not set"}</b>. Set its sub-type under Edit first.
        </p>
      ) : (
        <>
          <label className="label">This account is a</label>
          <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
            {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <p className="mt-2 text-xs text-slate-400">
            The account is not moved, renamed or re-posted. It becomes pickable on bookings,
            visa groups, rate charts and vouchers — which read parties, not the chart.
          </p>
        </>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        {options.length > 0 && (
          <button onClick={() => onLink(choice)} disabled={busy || !choice} className="btn">
            {busy ? "Saving…" : "Make a Party"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ── Move modal ───────────────────────────────────────────────────────────────
function MoveModal({ node, targets, busy, onCancel, onMove }: {
  node: AcctNode; targets: AcctNode[]; busy: boolean;
  onCancel: () => void; onMove: (target: string) => void;
}) {
  const [target, setTarget] = useState<string>(node.parent_id ?? "");
  return (
    <Modal title={`Move · ${node.name}`} onClose={onCancel}>
      <label className="label">New parent group</label>
      <SearchSelect value={target} onChange={setTarget} placeholder="— top level (root) —"
        options={targets.map((g) => ({ value: g.id, label: g.name, hint: g.code }))} />
      <p className="mt-2 text-xs text-slate-400">Balances and history are unaffected.</p>
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

// ── Move several at once ─────────────────────────────────────────────────────
// The same modal, told what it is moving. Listing the accounts matters here in
// a way it does not for one: a tick made three screens ago is easy to forget,
// and this is the last moment before the chart is rearranged.
function MoveManyModal({ nodes, targets, busy, onCancel, onMove }: {
  nodes: AcctNode[]; targets: AcctNode[]; busy: boolean;
  onCancel: () => void; onMove: (target: string) => void;
}) {
  const [target, setTarget] = useState<string>("");
  return (
    <Modal title={`Move ${nodes.length} account${nodes.length === 1 ? "" : "s"}`} onClose={onCancel}>
      <div className="max-h-40 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
        {nodes.map((n) => (
          <div key={n.id} className="truncate">
            <span className="font-mono text-slate-400">{n.code}</span> {n.name}
            {n.is_group && <span className="ml-1 text-[10px] uppercase text-amber-600">group</span>}
          </div>
        ))}
      </div>
      <label className="label mt-3">New parent group</label>
      <SearchSelect value={target} onChange={setTarget} placeholder="— top of the chart —"
        options={targets.map((t) => ({ value: t.id, label: t.name, hint: t.code }))} />
      <p className="mt-2 text-xs text-slate-400">
        Only where they SIT changes. An account keeps its id, so its ledger, its postings and
        anything pointing at it are untouched.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="btn-outline">Cancel</button>
        <button onClick={() => onMove(target)} disabled={busy} className="btn">
          {busy ? "Moving…" : `Move ${nodes.length}`}
        </button>
      </div>
    </Modal>
  );
}
