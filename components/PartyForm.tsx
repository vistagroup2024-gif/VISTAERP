"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

export interface PartyRow {
  id: string;
  party_type: string;
  name: string;
  code: string | null;
  phone: string | null;
  email: string | null;
  currency: string | null;
  credit_limit: number | null;
  credit_days?: number | null;
  sales_target?: number | null;
}

export default function PartyForm({ existing }: { existing?: PartyRow | null }) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!existing;
  const [form, setForm] = useState({
    party_type: existing?.party_type ?? "customer",
    name: existing?.name ?? "",
    code: existing?.code ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    currency: existing?.currency ?? "PKR",
    credit_limit: existing?.credit_limit ?? 0,
    credit_days: existing?.credit_days ?? 0,
    sales_target: existing?.sales_target ?? 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      party_type: form.party_type,
      name: form.name,
      code: form.code || null,
      phone: form.phone || null,
      email: form.email || null,
      currency: form.currency,
      credit_limit: Number(form.credit_limit),
      credit_days: Number(form.credit_days),
      sales_target: Number(form.sales_target),
    };
    const { error } = isEdit
      ? await supabase.from("parties").update(payload).eq("id", existing!.id)
      : await supabase.from("parties").insert({ company_id: COMPANY_ID, ...payload });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/parties");
    router.refresh();
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title={isEdit ? "Edit Party" : "New Party"} subtitle="Customer, B2B agent or supplier master record" />
      <form onSubmit={save} className="card space-y-6">
        {error && <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}

        <FormSection title="Basic Information">
          <Field label="Type" full>
            <select className="input" value={form.party_type} onChange={(e) => setForm({ ...form, party_type: e.target.value })}>
              <option value="customer">Customer (B2C)</option>
              <option value="b2b_agent">B2B Agent</option>
              <option value="supplier">Supplier</option>
            </select>
          </Field>
          <Field label="Name" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Code">
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
        </FormSection>

        <FormSection title="Financial Information" description="Currency and credit terms used across the ledger.">
          <Field label="Currency">
            <select className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option>PKR</option><option>SAR</option><option>USD</option><option>AED</option>
            </select>
          </Field>
          <Field label="Credit limit">
            <input className="input" type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: Number(e.target.value) })} />
          </Field>
          <Field label="Credit days">
            <input className="input" type="number" value={form.credit_days} onChange={(e) => setForm({ ...form, credit_days: Number(e.target.value) })} />
          </Field>
          {form.party_type !== "supplier" && (
            <Field label="Sales target">
              <input className="input" type="number" value={form.sales_target} onChange={(e) => setForm({ ...form, sales_target: Number(e.target.value) })} />
            </Field>
          )}
        </FormSection>

        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
