"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

type Grp = { id: string; code: string; name: string; type: string };

const SUBTYPES = ["Cash","Bank","Receivable","Payable","Inventory","Fixed Asset","Accumulated Depreciation","Tax","Revenue","COGS","Direct Expense","Indirect Expense","Equity","Drawing"];

export default function NewAccountPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const supabase = createClient();
  const [groups, setGroups] = useState<Grp[]>([]);
  const [form, setForm] = useState({
    parent: sp.get("parent") ?? "",
    name: "", name_ar: "", is_group: sp.get("group") === "1", subtype: "",
    nature: "expense", currency: "SAR", opening: "", opening_dr: true, code: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("accounts").select("id, code, name, type").eq("is_group", true).order("code")
      .then(({ data }) => setGroups((data ?? []) as Grp[]));
  }, [supabase]);

  const parent = useMemo(() => groups.find((g) => g.id === form.parent), [groups, form.parent]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    const { data, error } = await supabase.rpc("acct_create", {
      p_company: COMPANY_ID,
      p_parent: form.parent || null,
      p_name: form.name,
      p_name_ar: form.name_ar || null,
      p_is_group: form.is_group,
      p_subtype: form.subtype || null,
      p_nature: form.parent ? null : form.nature,
      p_currency: form.currency,
      p_opening: form.opening ? Number(form.opening) : 0,
      p_opening_is_debit: form.opening_dr,
      p_code: form.code || null,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/accounting/accounts"); router.refresh();
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="New Account" subtitle="Create a ledger account or group in the chart of accounts" />
      <form onSubmit={save} className="card space-y-6">
        {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}

        <FormSection title="Account Details">
          <Field label="Parent group" full>
            <select className="input" value={form.parent} onChange={(e) => setForm({ ...form, parent: e.target.value })}>
              <option value="">— none (root) —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.code} · {g.name}</option>)}
            </select>
            {parent && <p className="mt-1 text-xs text-slate-500">Nature inherited: <b>{parent.type}</b>. Code auto-generated under {parent.code}.</p>}
          </Field>

          {!form.parent && (
            <>
              <Field label="Nature (root only)">
                <select className="input" value={form.nature} onChange={(e) => setForm({ ...form, nature: e.target.value })}>
                  <option value="asset">Asset</option><option value="liability">Liability</option>
                  <option value="equity">Equity</option><option value="income">Income</option>
                  <option value="expense">Expense</option><option value="control">Control</option>
                </select>
              </Field>
              <Field label="Code (optional)">
                <input className="input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="auto" />
              </Field>
            </>
          )}

          <Field label="Account name (EN)">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </Field>
          <Field label="Name (AR)">
            <input className="input text-right" dir="rtl" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
          </Field>

          <label className="flex items-center gap-2 text-sm sm:col-span-full">
            <input type="checkbox" checked={form.is_group} onChange={(e) => setForm({ ...form, is_group: e.target.checked })} />
            This is a <b>group</b> (container — cannot be posted to)
          </label>
        </FormSection>

        {!form.is_group && (
          <FormSection title="Posting Details">
            <Field label="Sub-type">
              <select className="input" value={form.subtype} onChange={(e) => setForm({ ...form, subtype: e.target.value })}>
                <option value="">—</option>
                {SUBTYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Currency">
              <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option>SAR</option><option>PKR</option><option>USD</option>
              </select>
            </Field>
            <Field label="Opening balance">
              <input className="input text-right tabular-nums" inputMode="decimal" value={form.opening}
                onChange={(e) => setForm({ ...form, opening: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Opening side">
              <select className="input" value={form.opening_dr ? "dr" : "cr"} onChange={(e) => setForm({ ...form, opening_dr: e.target.value === "dr" })}>
                <option value="dr">Debit</option><option value="cr">Credit</option>
              </select>
            </Field>
            <p className="text-xs text-slate-400 sm:col-span-full">Opening balance posts an opening entry against <b>9-01 Opening Balance Control</b>, so the trial balance stays balanced.</p>
          </FormSection>
        )}

        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save account"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
