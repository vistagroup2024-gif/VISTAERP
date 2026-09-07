"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { useDocRights } from "@/components/AccessProvider";

// One node as returned by the acct_tree RPC (flat list; tree built client-side).
export type AcctNode = {
  id: string; code: string; name: string; name_ar: string | null;
  nature: "asset" | "liability" | "equity" | "income" | "expense" | "control";
  is_group: boolean; is_postable: boolean; parent_id: string | null; path: string | null;
  currency: string; subtype: string | null; status: string;
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
    Array.from(m.values()).forEach((arr) => arr.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
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

  async function doMove(target: string) {
    if (!moving) return;
    setBusy(true); setOpErr(null);
    const { error } = await supabase.from("accounts").update({ parent_id: target || null }).eq("id", moving.id);
    if (!error) await supabase.rpc("acct_rebuild_paths", { p_company: COMPANY_ID });
    setBusy(false);
    if (error) return setOpErr(error.message);
    setMoving(null); router.refresh();
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

  // Groups eligible as a move target: not the node itself and not its descendants.
  const moveTargets = useMemo(() => {
    if (!moving) return [];
    const p = moving.path;
    const blocked = new Set(nodes.filter((n) => p && n.path && (n.path === p || n.path.startsWith(p + "/"))).map((n) => n.id));
    return nodes.filter((n) => n.is_group && !blocked.has(n.id)).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }, [moving, nodes]);

  function Row({ n, depth }: { n: AcctNode; depth: number }) {
    if (visible && !visible.has(n.id)) return null;
    const kids = childrenOf.get(n.id) ?? [];
    const hasKids = kids.length > 0;
    const isOpen = visible ? true : !collapsed.has(n.id);
    const net = rollup.get(n.id) ?? 0;
    const isSel = sel === n.id;
    const groupBg = n.is_group ? (depth === 0 ? "bg-slate-100" : depth === 1 ? "bg-slate-50" : "bg-slate-50/60") : "";
    return (
      <>
        <div className={`group flex items-stretch border-b border-slate-100 ${isSel ? "bg-brand-100 ring-1 ring-inset ring-brand-300" : `hover:bg-brand-50/40 ${groupBg}`}`}>
          {Array.from({ length: depth }).map((_, i) => (
            <span key={i} className="shrink-0 border-l border-slate-400" style={{ width: "var(--tree-indent, 18px)" }} />
          ))}
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
            {!n.is_group && <span className={`badge ${NATURE_BADGE[n.nature]} hidden shrink-0 sm:inline-flex`}>{n.subtype ?? n.nature}</span>}
            <span className={`w-20 shrink-0 text-right tabular-nums text-xs sm:w-40 sm:text-sm ${n.is_group ? "font-semibold" : ""}`}>{drcr(net)}</span>
          </div>
        </div>
        {isOpen && hasKids && kids.map((k) => <Row key={k.id} n={k} depth={depth + 1} />)}
      </>
    );
  }

  const btn = "btn-outline btn-sm disabled:opacity-40";

  return (
    <div className="card p-0">
      {/* Master toolbar */}
      <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-slate-200 p-2">
        <button onClick={() => add(false)} disabled={!rights.canCreate} title={rights.denied("create")} className={btn}>+ Add</button>
        <button onClick={() => add(true)} disabled={!rights.canCreate} title={rights.denied("create")} className={btn}>+ Add Group</button>
        <span className="mx-1 h-5 w-px bg-slate-200" />
        <button onClick={() => selNode && setEditing(selNode)} disabled={!selNode || !rights.canEdit} title={rights.denied("edit")} className={btn}>Edit</button>
        <button onClick={() => selNode && setMoving(selNode)} disabled={!selNode || !rights.canEdit} title={rights.denied("edit")} className={btn}>Move</button>
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
        <button onClick={() => setCollapsed(new Set())} className={btn}>Expand all</button>
        <button onClick={() => setCollapsed(new Set(nodes.filter((n) => n.is_group).map((n) => n.id)))} className={btn}>Collapse all</button>
        <button onClick={() => window.print()} disabled={!rights.canPrint} title={rights.denied("print")} className={btn}>Print</button>
        <span className="ml-auto max-w-[40%] truncate text-xs text-slate-400">
          {selNode ? <>Selected: <b className="text-slate-600">{selNode.name}</b></> : `${nodes.length} accounts`}
        </span>
      </div>

      <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, Arabic, type…" className="input max-w-xs" />
        {opErr && <span className="text-xs text-danger">{opErr}</span>}
      </div>

      <div className="hidden items-center gap-2 border-b border-slate-200 bg-slate-50 py-2 pr-3 pl-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 sm:flex">
        <span className="w-4" /><span className="flex-1">Account</span><span className="w-40 text-right">Balance</span>
      </div>
      <div className="max-h-[70vh] overflow-auto text-sm [--tree-indent:11px] sm:[--tree-indent:18px]">
        {roots.map((r) => <Row key={r.id} n={r} depth={0} />)}
        {roots.length === 0 && <div className="p-6 text-center text-slate-400">No accounts.</div>}
      </div>

      {editing && <PropsModal node={editing} busy={busy} onCancel={() => setEditing(null)} onSave={saveProps} />}
      {moving && <MoveModal node={moving} targets={moveTargets} busy={busy} onCancel={() => setMoving(null)} onMove={doMove} />}
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
      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
        <option value="">— top level (root) —</option>
        {targets.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
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
