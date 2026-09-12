"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useDocRights } from "@/components/AccessProvider";

type Approver = { user_id: string; name: string | null };
type Rule = {
  id: string; name: string | null; doc_type: string; doc_types: string[]; min_amount: number;
  cost_center: string | null; cost_centers: string[];
  created_by: string | null; created_bys: string[];
  created_by_name: string | null; created_by_names: string[];
  approvals_needed: number; active: boolean; approvers: Approver[];
};
type StaffUser = { id: string; full_name: string | null; email: string | null };
type Authorizer = { user_id: string; name: string; is_admin: boolean; limit: number | null };

// Every voucher in the ERP, and whether a rule can actually hold it.
//
// `gated` is not a preference — it is whether the voucher's save goes through
// one of the two authorisation gates. The line vouchers go through gl_submit;
// the four trade documents that post and payroll are held as whole documents
// and posted by their own routine on approval. Everything else posts through an
// engine that never consults the rules, so a rule naming it would sit there
// looking effective and hold nothing. They are listed, and they are listed as
// unavailable, because "it is not in the list" and "it cannot be held" are
// different answers and only one of them is true.
type DocType = { key: string; label: string; group: string; gated: boolean };
const DOC_TYPES: DocType[] = [
  { key: "gl_receipt",       label: "Receipt",           group: "Cash and Bank", gated: true },
  { key: "gl_payment",       label: "Payment",           group: "Cash and Bank", gated: true },
  { key: "gl_contra",        label: "Contra",            group: "Cash and Bank", gated: true },
  { key: "gl_petty",         label: "Petty Cash",        group: "Cash and Bank", gated: true },
  { key: "gl_journal",       label: "Journal Entry",     group: "Journals",      gated: true },
  { key: "gl_payroll",       label: "Payroll",           group: "Payroll",       gated: true },
  { key: "purchase_voucher", label: "Purchase Voucher",  group: "Purchases",     gated: true },
  { key: "purchase_return",  label: "Purchase Return",   group: "Purchases",     gated: true },
  { key: "sales_invoice",    label: "Sales Invoice",     group: "Sales",         gated: true },
  { key: "sales_return",     label: "Sales Return",      group: "Sales",         gated: true },
  { key: "air_ticket_invoice", label: "Air Ticket Invoice", group: "Sales",        gated: true },
  // Post through an engine rather than through a gate.
  { key: "pdc",              label: "PDC Register",      group: "Cash and Bank", gated: false },
  { key: "invoice_bill",     label: "Bill Record",       group: "Journals",      gated: false },
  { key: "car_invoice",      label: "Car Invoice",       group: "Car Sales",     gated: false },
  { key: "car_expense",      label: "Car Expense",       group: "Car Sales",     gated: false },
  { key: "visa_invoice",     label: "Visa Invoice",      group: "Module Invoicing", gated: false },
  { key: "transport_invoice",label: "Transport Invoice", group: "Module Invoicing", gated: false },
  { key: "hotel_invoice",    label: "Hotel Invoice",     group: "Module Invoicing", gated: false },
];
const label = (k: string) => DOC_TYPES.find((d) => d.key === k)?.label ?? k;
const DOC_GROUPS = Array.from(new Set(DOC_TYPES.map((d) => d.group)));

/** A row of chips: click to add, click again to drop. Empty means the whole
 *  set, which is the convention the rest of the access model uses. */
function Chips({ options, value, onChange, empty }: {
  options: { v: string; l: string; off?: boolean; why?: string }[];
  value: string[]; onChange: (v: string[]) => void; empty: string;
}) {
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.v} type="button" disabled={o.off} title={o.why}
          onClick={() => toggle(o.v)}
          className={`rounded-full border px-2.5 py-1 text-xs ${
            o.off ? "cursor-not-allowed border-slate-100 text-slate-300"
            : value.includes(o.v) ? "border-brand bg-brand/10 font-medium text-brand-700"
            : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
          {value.includes(o.v) ? "✓ " : ""}{o.l}
        </button>
      ))}
      {value.length === 0 && <span className="self-center text-xs text-slate-400">{empty}</span>}
    </div>
  );
}
const money = (n: number) => Number(n || 0).toLocaleString();

const blank = () => ({
  id: null as string | null, name: "", doc_types: [] as string[], min_amount: "0",
  cost_centers: [] as string[], created_bys: [] as string[],
  approvals_needed: "1", active: true,
  approvers: [] as string[],
});

export default function RulesPage() {
  const rights = useDocRights("auth_rules");
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [costCenters, setCostCenters] = useState<{ id: string; name: string }[]>([]);
  const [authorizers, setAuthorizers] = useState<Authorizer[]>([]);
  const [f, setF] = useState(blank());
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [{ data: rl }, { data: su }, { data: cc }, { data: az }] = await Promise.all([
      supabase.rpc("acct_rules_list"),
      supabase.rpc("staff_users_list", { p_id: null }),
      supabase.from("acct_cost_centers").select("id, name").eq("is_active", true).eq("is_group", false).order("name"),
      supabase.rpc("acct_list_authorizers"),
    ]);
    setRules((rl as Rule[]) ?? []);
    setStaff((su as StaffUser[]) ?? []);
    setCostCenters((cc as any[]) ?? []);
    setAuthorizers((az as Authorizer[]) ?? []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const nameOf = useMemo(() => {
    const m = new Map(staff.map((u) => [u.id, u.full_name || u.email || "—"]));
    return (id: string) => m.get(id) ?? "—";
  }, [staff]);

  function edit(r: Rule) {
    setF({
      id: r.id, name: r.name ?? "",
      doc_types: r.doc_types?.length ? r.doc_types : [r.doc_type],
      min_amount: String(r.min_amount),
      cost_centers: r.cost_centers ?? [], created_bys: r.created_bys ?? [],
      approvals_needed: String(r.approvals_needed), active: r.active,
      approvers: r.approvers.map((a) => a.user_id),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setErr(null);
    const { error } = await supabase.rpc("acct_rule_save", {
      p_id: f.id,
      p_rule: {
        name: f.name, doc_types: f.doc_types, min_amount: f.min_amount,
        cost_centers: f.cost_centers, created_bys: f.created_bys,
        approvals_needed: f.approvals_needed, active: f.active,
      },
      p_approvers: f.approvers,
    });
    setSaving(false);
    if (error) return setErr(error.message);
    setF(blank()); load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this rule? Vouchers it would have held will post on save.")) return;
    const { error } = await supabase.rpc("acct_rule_delete", { p_id: id });
    if (error) return setErr(error.message);
    load();
  }

  async function setLimit(u: Authorizer) {
    const v = prompt(`Authorisation limit for ${u.name} (blank = no limit):`, u.limit == null ? "" : String(u.limit));
    if (v === null) return;
    const { error } = await supabase.rpc("acct_set_authorize_limit",
      { p_user: u.user_id, p_limit: v.trim() === "" ? null : Number(v) || 0 });
    if (error) return setErr(error.message);
    load();
  }

  const toggle = (id: string) =>
    setF((c) => ({ ...c, approvers: c.approvers.includes(id) ? c.approvers.filter((x) => x !== id) : [...c.approvers, id] }));

  return (
    <div className="max-w-5xl space-y-5">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Voucher Authorisation</h1>
      <p className="text-sm text-slate-500">
        A voucher posts the moment it is saved <b>unless a rule says otherwise</b>. A rule can test
        several voucher types, an amount, several cost centres and several people — in any
        combination — so
        &ldquo;over 100 in Car Sales Installment&rdquo; and &ldquo;anything Saad raises&rdquo; are both
        rules, and the more specific one wins when both match. A minimum of 0 means every voucher of
        that type.
      </p>
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <form onSubmit={save} className="card space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-700">{f.id ? "Edit rule" : "New rule"}</h2>
          {f.id && <button type="button" onClick={() => setF(blank())} className="text-xs text-brand hover:underline">start a new one instead</button>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3"><label className="label">Rule name</label>
            <input className="input" placeholder="e.g. Car sales payments over 100"
              value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>

          <div className="sm:col-span-3"><label className="label">Voucher types</label>
            <div className="space-y-2">
              {DOC_GROUPS.map((g) => (
                <div key={g} className="flex flex-wrap items-baseline gap-2">
                  <span className="w-32 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g}</span>
                  <Chips
                    options={DOC_TYPES.filter((d) => d.group === g).map((d) => ({
                      v: d.key, l: d.label, off: !d.gated,
                      why: d.gated ? undefined
                        : "This voucher posts through an engine rather than through the authorisation gate, so a rule cannot hold it.",
                    }))}
                    value={f.doc_types} onChange={(v) => setF({ ...f, doc_types: v })}
                    empty="" />
                </div>
              ))}
            </div>
            {f.doc_types.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">Pick at least one — a rule with no voucher type holds nothing.</p>
            )}
            <p className="mt-1 text-xs text-slate-400">
              Greyed out means the voucher posts through an engine rather than through the
              authorisation gate, so no rule can hold it.
            </p></div>

          <div><label className="label">Amount from (SAR)</label>
            <input className="input text-right tabular-nums" inputMode="decimal"
              value={f.min_amount} onChange={(e) => setF({ ...f, min_amount: e.target.value })} />
            <p className="mt-1 text-xs text-slate-400">0 = every voucher of these types.</p></div>

          <div className="sm:col-span-2"><label className="label">Cost centres</label>
            <Chips options={costCenters.map((c) => ({ v: c.name, l: c.name }))}
              value={f.cost_centers} onChange={(v) => setF({ ...f, cost_centers: v })}
              empty="Any cost centre" /></div>

          <div className="sm:col-span-3"><label className="label">Only when raised by</label>
            <Chips options={staff.map((u) => ({ v: u.id, l: u.full_name || u.email || "—" }))}
              value={f.created_bys} onChange={(v) => setF({ ...f, created_bys: v })}
              empty="Anyone" /></div>

          <div><label className="label">Approvals needed</label>
            <input className="input text-right" type="number" min={1}
              value={f.approvals_needed} onChange={(e) => setF({ ...f, approvals_needed: e.target.value })} /></div>

          <label className="flex items-center gap-2 pb-1 text-sm sm:col-span-1">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            Active
          </label>
        </div>

        <div>
          <label className="label">Who may authorise it</label>
          <div className="flex flex-wrap gap-2">
            {staff.map((u) => (
              <button key={u.id} type="button" onClick={() => toggle(u.id)}
                className={`rounded-full border px-3 py-1 text-sm ${f.approvers.includes(u.id)
                  ? "border-brand bg-brand/10 font-medium text-brand-700"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                {f.approvers.includes(u.id) ? "✓ " : ""}{u.full_name || u.email}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Nobody picked = whoever may authorise this voucher type. A maker can never approve their
            own voucher, and an admin can always approve.
          </p>
        </div>

        <div className="flex gap-2 border-t border-slate-100 pt-3">
          <button className="btn disabled:opacity-40" disabled={saving || f.doc_types.length === 0 || !(f.id ? rights.canEdit : rights.canCreate)}
            title={rights.denied(f.id ? "edit" : "create")}>
            {saving ? "Saving…" : f.id ? "Save changes" : "Add rule"}
          </button>
          <button type="button" className="btn-outline" onClick={() => setF(blank())}>Clear</button>
        </div>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Rule</th><th className="px-3 py-2 text-left">Voucher</th>
              <th className="px-3 py-2 text-right">From</th><th className="px-3 py-2 text-left">Cost centre</th>
              <th className="px-3 py-2 text-left">Raised by</th><th className="px-3 py-2 text-right">Approvals</th>
              <th className="px-3 py-2 text-left">Authorised by</th><th className="px-3 py-2 text-center">Active</th><th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={`border-t border-slate-100 ${r.active ? "" : "text-slate-400"}`}>
                <td className="px-3 py-2 font-medium">{r.name || "—"}</td>
                <td className="px-3 py-2">{(r.doc_types?.length ? r.doc_types : [r.doc_type]).map(label).join(", ")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(r.min_amount) === 0 ? "any" : money(r.min_amount)}</td>
                <td className="px-3 py-2">{r.cost_centers?.length ? r.cost_centers.join(", ") : <span className="text-slate-400">any</span>}</td>
                <td className="px-3 py-2">{r.created_by_names?.length ? r.created_by_names.join(", ") : <span className="text-slate-400">anyone</span>}</td>
                <td className="px-3 py-2 text-right">{r.approvals_needed}</td>
                <td className="px-3 py-2">
                  {r.approvers.length ? r.approvers.map((a) => a.name ?? nameOf(a.user_id)).join(", ")
                    : <span className="text-slate-400">the voucher type&apos;s approvers</span>}
                </td>
                <td className="px-3 py-2 text-center">{r.active ? "✓" : "—"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={() => edit(r)} disabled={!rights.canEdit} title={rights.denied("edit")}
                    className="text-brand hover:underline disabled:opacity-40">Edit</button>
                  <button onClick={() => remove(r.id)} disabled={!rights.canDelete} title={rights.denied("delete")}
                    className="ml-3 text-red-500 hover:underline disabled:opacity-40">Delete</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={9}>
                No rules — every voucher posts the moment it is saved.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="pt-2 text-lg font-bold">Authorisation limits</h2>
      <p className="text-sm text-slate-500">The largest voucher each person may approve, whatever the rule says. Blank = no limit. Admins bypass it. Only an admin can change these.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-right">Limit (SAR)</th><th /></tr>
          </thead>
          <tbody>
            {authorizers.map((u) => (
              <tr key={u.user_id} className="border-t border-slate-100">
                <td className="px-3 py-2">{u.name}{u.is_admin && <span className="ml-2 rounded bg-brand/10 px-1.5 text-[10px] uppercase text-brand">admin</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{u.is_admin ? "—" : (u.limit == null ? "No limit" : money(u.limit))}</td>
                <td className="px-3 py-2 text-right">{!u.is_admin && <button onClick={() => setLimit(u)} disabled={!rights.canEdit} title={rights.denied("edit")} className="text-brand hover:underline disabled:opacity-40">Set limit</button>}</td>
              </tr>
            ))}
            {authorizers.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={3}>No authorisers, or you are not an admin.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
