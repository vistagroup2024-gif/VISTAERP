"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import FormSection, { Field } from "@/components/ui/FormSection";

export default function NewHotelPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    name: "",
    city: "makkah",
    rating: 5,
    distance_haram_m: "",
    address: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await supabase.from("hotels").insert({
      company_id: COMPANY_ID,
      name: form.name,
      city: form.city,
      rating: Number(form.rating),
      distance_haram_m: form.distance_haram_m ? Number(form.distance_haram_m) : null,
      address: form.address || null,
    });
    setSaving(false);
    if (error) return setError(error.message);
    router.push("/hotels");
    router.refresh();
  }

  return (
    <div className="max-w-lg">
      <PageHeader title="New Hotel" subtitle="Hotel master record" />
      <form onSubmit={save} className="card space-y-6">
        {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}
        <FormSection title="Hotel Details">
          <Field label="Hotel name" required full>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="City">
            <select className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}>
              <option value="makkah">Makkah</option>
              <option value="madinah">Madinah</option>
              <option value="jeddah">Jeddah</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Rating (1-7)">
            <input className="input" type="number" min={1} max={7} value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} />
          </Field>
          <Field label="Distance to Haram (meters)">
            <input className="input" type="number" value={form.distance_haram_m} onChange={(e) => setForm({ ...form, distance_haram_m: e.target.value })} />
          </Field>
          <Field label="Address">
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        </FormSection>
        <div className="flex gap-2 border-t border-slate-100 pt-4">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save hotel"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
