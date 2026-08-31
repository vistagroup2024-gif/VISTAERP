"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

type Item = {
  service_type: string;
  description: string;
  qty: number;
  cost_currency: string;
  cost_price: number;
  sell_currency: string;
  sell_price: number;
};

const blank: Item = {
  service_type: "hotel",
  description: "",
  qty: 1,
  cost_currency: "SAR",
  cost_price: 0,
  sell_currency: "PKR",
  sell_price: 0,
};

export default function NewPackagePage() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [days, setDays] = useState(14);
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<Item[]>([{ ...blank, service_type: "visa" }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update(i: number, patch: Partial<Item>) {
    setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data: pkg, error } = await supabase
      .from("packages")
      .insert({
        company_id: COMPANY_ID,
        name,
        code: code || null,
        description: description || null,
        duration_days: days,
        status: "active",
      })
      .select("id")
      .single();
    if (error || !pkg) {
      setSaving(false);
      return setError(error?.message ?? "Failed");
    }
    if (items.length) {
      const { error: e2 } = await supabase.from("package_items").insert(
        items.map((it, idx) => ({ ...it, package_id: pkg.id, sort_order: idx }))
      );
      if (e2) {
        setSaving(false);
        return setError(e2.message);
      }
    }
    router.push(`/packages/${pkg.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New Package" subtitle="Define a package and its component services" />
      <form onSubmit={save} className="space-y-6">
        {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}
        <div className="card space-y-6">
          <FormSection title="Package Details">
            <Field label="Package name" full>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Code">
              <input className="input" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Duration (days)">
              <input className="input" type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </Field>
            <Field label="Description" full>
              <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </FormSection>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Components</h2>
            <button type="button" className="btn-outline" onClick={() => setItems([...items, { ...blank }])}>
              + Add line
            </button>
          </div>
          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 rounded-md border border-slate-100 p-3">
                <select className="input col-span-2" value={it.service_type} onChange={(e) => update(i, { service_type: e.target.value })}>
                  <option value="hotel">Hotel</option>
                  <option value="transport">Transport</option>
                  <option value="visa">Visa</option>
                  <option value="air_ticket">Air ticket</option>
                  <option value="other">Other</option>
                </select>
                <input className="input col-span-4" placeholder="Description" value={it.description} onChange={(e) => update(i, { description: e.target.value })} required />
                <input className="input col-span-1" type="number" title="Qty" value={it.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} />
                <select className="input col-span-1" value={it.cost_currency} onChange={(e) => update(i, { cost_currency: e.target.value })}>
                  <option>SAR</option><option>USD</option><option>PKR</option><option>AED</option>
                </select>
                <input className="input col-span-2" type="number" placeholder="Cost" value={it.cost_price} onChange={(e) => update(i, { cost_price: Number(e.target.value) })} />
                <input className="input col-span-2" type="number" placeholder="Sell (PKR)" value={it.sell_price} onChange={(e) => update(i, { sell_price: Number(e.target.value) })} />
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save package"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
