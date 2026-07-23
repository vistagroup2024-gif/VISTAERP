"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { PERMISSION_CATALOG, ALL_PERM_KEYS } from "@/lib/permissions";

export default function AgentForm({
  parties, existing,
}: {
  parties: { id: string; name: string }[];
  existing?: any;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!existing?.id;

  const [f, setF] = useState({
    agent_party_id: existing?.agent_party_id ?? "",
    agency_name: existing?.agency_name ?? "",
    contact_person: existing?.contact_person ?? "",
    username: existing?.username ?? "",
    email: existing?.email ?? "",
    mobile: existing?.mobile ?? "",
    country: existing?.country ?? "",
    currency: existing?.currency ?? "SAR",
    status: existing?.status ?? "active",
    credit_limit: existing?.credit_limit ?? 0,
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>(existing?.permissions ?? {});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function togglePerm(k: string) { setPerms((p) => ({ ...p, [k]: !p[k] })); }
  function setAll(v: boolean) { setPerms(Object.fromEntries(ALL_PERM_KEYS.map((k) => [k, v]))); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.agent_party_id) return setError("Select the agency from the Customers / Agent list");
    if (!f.username.trim()) return setError("Username is required");
    if (!isEdit && password.length < 6) return setError("Password must be at least 6 characters");
    if (password && password !== confirm) return setError("Passwords do not match");

    setSaving(true); setError(null);
    const agencyName = parties.find((p) => p.id === f.agent_party_id)?.name ?? f.agency_name;
    const payload = {
      company_id: COMPANY_ID,
      agent_party_id: f.agent_party_id,
      agency_name: agencyName,
      contact_person: f.contact_person.trim() || null,
      username: f.username.trim(),
      email: f.email.trim() || null,
      mobile: f.mobile.trim() || null,
      country: f.country.trim() || null,
      currency: f.currency,
      status: f.status,
      credit_limit: Number(f.credit_limit) || 0,
      permissions: perms,
    };
    const dup = (e: any) => /duplicate key|unique/i.test(e?.message ?? "") ? "This username already exists." : e.message;

    let id = existing?.id;
    if (isEdit) {
      const { error } = await supabase.from("b2b_agents").update(payload).eq("id", existing.id);
      if (error) { setSaving(false); return setError(dup(error)); }
    } else {
      const { data, error } = await supabase.from("b2b_agents").insert(payload).select("id").single();
      if (error) { setSaving(false); return setError(dup(error)); }
      id = data!.id;
    }
    if (password) {
      const { error: pe } = await supabase.rpc("set_b2b_password", { p_agent: id, p_password: password });
      if (pe) { setSaving(false); return setError(pe.message); }
    }
    setSaving(false);
    router.push("/settings/agents"); router.refresh();
  }

  return (
    <form onSubmit={save} className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">{isEdit ? "Edit B2B Agent" : "New B2B Agent"}</h1>
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="card grid grid-cols-2 gap-4 md:grid-cols-3">
        <div className="col-span-2">
          <label className="label">Agency (from Customers / Agent list)</label>
          <input className="input" list="agent-parties" value={parties.find((p) => p.id === f.agent_party_id)?.name ?? f.agency_name}
            onChange={(e) => {
              const p = parties.find((x) => x.name === e.target.value);
              setF({ ...f, agent_party_id: p?.id ?? "", agency_name: e.target.value });
            }} placeholder="Search agency…" />
          <datalist id="agent-parties">{parties.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        </div>
        <div><label className="label">Contact person</label>
          <input className="input" value={f.contact_person} onChange={(e) => setF({ ...f, contact_person: e.target.value })} /></div>
        <div><label className="label">Username</label>
          <input className="input font-mono" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></div>
        <div><label className="label">Password {isEdit && <span className="text-slate-400">(leave blank to keep)</span>}</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
        <div><label className="label">Confirm password</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></div>
        <div><label className="label">Email</label>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">Mobile</label>
          <input className="input" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></div>
        <div><label className="label">Country</label>
          <input className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></div>
        <div><label className="label">Currency</label>
          <select className="input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option>SAR</option><option>USD</option><option>PKR</option><option>AED</option>
          </select></div>
        <div><label className="label">Status</label>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </select></div>
        <div><label className="label">Credit limit</label>
          <input className="input" type="number" min={0} value={f.credit_limit} onChange={(e) => setF({ ...f, credit_limit: Number(e.target.value) })} /></div>
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-700">Module Permissions</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-outline text-xs" onClick={() => setAll(true)}>Select all</button>
            <button type="button" className="btn-outline text-xs" onClick={() => setAll(false)}>Clear all</button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PERMISSION_CATALOG.map((g) => (
            <div key={g.module} className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">{g.module}</p>
              <div className="space-y-1">
                {g.perms.map((p) => (
                  <label key={p.key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                    <input type="checkbox" checked={!!perms[p.key]} onChange={() => togglePerm(p.key)} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save changes" : "Create agent"}</button>
        <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  );
}
