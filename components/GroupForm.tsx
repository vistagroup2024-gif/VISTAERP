"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AirportSelect, { Airport } from "@/components/AirportSelect";

export interface GroupInitial {
  id?: string;
  group_no?: string;
  group_date?: string;
  group_name?: string | null;
  pax?: number;
  agent_id?: string | null;
  ref_company_id?: string | null;
  arrival_date?: string;
  arrival_flight?: string | null;
  arrival_from?: string | null;
  arrival_airport?: string | null;
  departure_date?: string;
  departure_flight?: string | null;
  departure_to?: string | null;
  departure_airport?: string | null;
  remarks?: string | null;
}

export default function GroupForm({
  airports, agents, companies, existing,
}: {
  airports: Airport[];
  agents: { id: string; name: string }[];
  companies: { id: string; name: string }[];
  existing?: GroupInitial;
}) {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!existing?.id;

  const [f, setF] = useState({
    group_no: existing?.group_no ?? "",
    group_date: existing?.group_date ?? new Date().toISOString().slice(0, 10),
    group_name: existing?.group_name ?? "",
    pax: existing?.pax ?? 0,
    agent_id: existing?.agent_id ?? "",
    ref_company_id: existing?.ref_company_id ?? companies[0]?.id ?? "",
    arrival_date: existing?.arrival_date ?? "",
    arrival_flight: existing?.arrival_flight ?? "",
    arrival_from: existing?.arrival_from ?? "",
    arrival_airport: existing?.arrival_airport ?? "",
    departure_date: existing?.departure_date ?? "",
    departure_flight: existing?.departure_flight ?? "",
    departure_to: existing?.departure_to ?? "",
    departure_airport: existing?.departure_airport ?? "",
    remarks: existing?.remarks ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isEdit) return;
    (async () => {
      const { data } = await supabase.rpc("next_group_no", { p_company: COMPANY_ID });
      if (data) setF((prev) => ({ ...prev, group_no: data as string }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nights =
    f.arrival_date && f.departure_date && f.departure_date > f.arrival_date
      ? Math.round((+new Date(f.departure_date) - +new Date(f.arrival_date)) / 86400000) : 0;

  function set<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((prev) => ({ ...prev, [k]: v }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.group_no.trim()) return setError("Group number is required");
    if (Number(f.pax) <= 0) return setError("Pax must be greater than zero");
    if (!f.arrival_date || !f.departure_date) return setError("Arrival and departure dates are required");
    if (f.departure_date <= f.arrival_date) return setError("Departure must be after arrival");
    if (!f.arrival_flight.trim() || !f.departure_flight.trim()) return setError("Flight numbers are mandatory");
    if (!f.arrival_from || !f.arrival_airport || !f.departure_to || !f.departure_airport)
      return setError("Select all cities/airports from the dropdowns");

    setSaving(true);
    setError(null);
    const payload = {
      company_id: COMPANY_ID,
      group_no: f.group_no.trim(),
      group_date: f.group_date,
      group_name: f.group_name.trim() || null,
      pax: Number(f.pax),
      agent_id: f.agent_id || null,
      ref_company_id: f.ref_company_id || null,
      arrival_date: f.arrival_date,
      arrival_flight: f.arrival_flight.trim(),
      arrival_from: f.arrival_from,
      arrival_airport: f.arrival_airport,
      departure_date: f.departure_date,
      departure_flight: f.departure_flight.trim(),
      departure_to: f.departure_to,
      departure_airport: f.departure_airport,
      remarks: f.remarks.trim() || null,
    };

    if (isEdit) {
      const { error } = await supabase.from("umrah_groups").update(payload).eq("id", existing!.id!);
      setSaving(false);
      if (error) return setError(error.message);
      router.push(`/groups/${existing!.id}`);
    } else {
      const { data, error } = await supabase.from("umrah_groups").insert(payload).select("id").single();
      setSaving(false);
      if (error) return setError(error.message);
      router.push(`/groups/${data!.id}`);
    }
    router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">{isEdit ? "Edit Visa Group" : "New Visa Group"}</h1>
      <p className="mb-6 text-sm text-slate-500">
        {isEdit ? "Update group details." : "Register a group. After saving you can auto-allocate hotel BRNs for the stay."}
      </p>
      <form onSubmit={save} className="space-y-5">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Group Information</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <label className="label">Group number</label>
              <input className="input font-mono" value={f.group_no} onChange={(e) => set("group_no", e.target.value)} />
            </div>
            <div>
              <label className="label">Date</label>
              <input className="input" type="date" value={f.group_date} onChange={(e) => set("group_date", e.target.value)} />
            </div>
            <div>
              <label className="label">Pax (pilgrims)</label>
              <input className="input" type="number" min={1} value={f.pax || ""} onChange={(e) => set("pax", Number(e.target.value))} required />
            </div>
            <div className="md:col-span-3">
              <label className="label">Group name</label>
              <input className="input" value={f.group_name} onChange={(e) => set("group_name", e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="label">Agent</label>
              <select className="input" value={f.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
                <option value="">—</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Company</label>
              <select className="input" value={f.ref_company_id} onChange={(e) => set("ref_company_id", e.target.value)}>
                <option value="">—</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Arrival Flight</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="label">Arrival date</label>
              <input className="input" type="date" value={f.arrival_date} onChange={(e) => set("arrival_date", e.target.value)} required />
            </div>
            <div>
              <label className="label">Flight number</label>
              <input className="input" value={f.arrival_flight} onChange={(e) => set("arrival_flight", e.target.value)} placeholder="SV-701" />
            </div>
            <div>
              <label className="label">From (city)</label>
              <AirportSelect airports={airports} value={f.arrival_from} onChange={(c) => set("arrival_from", c)} placeholder="Origin city" />
            </div>
            <div>
              <label className="label">Arrival airport (Saudi)</label>
              <AirportSelect airports={airports} value={f.arrival_airport} onChange={(c) => set("arrival_airport", c)} placeholder="Saudi airport" saudiOnly />
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-700">Departure Flight</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="label">Departure date</label>
              <input className="input" type="date" value={f.departure_date} onChange={(e) => set("departure_date", e.target.value)} required />
            </div>
            <div>
              <label className="label">Flight number</label>
              <input className="input" value={f.departure_flight} onChange={(e) => set("departure_flight", e.target.value)} placeholder="SV-702" />
            </div>
            <div>
              <label className="label">Departure airport (Saudi)</label>
              <AirportSelect airports={airports} value={f.departure_airport} onChange={(c) => set("departure_airport", c)} placeholder="Saudi airport" saudiOnly />
            </div>
            <div>
              <label className="label">To (international city)</label>
              <AirportSelect airports={airports} value={f.departure_to} onChange={(c) => set("departure_to", c)} placeholder="Destination city" />
            </div>
          </div>
          <div className="rounded-lg bg-brand/5 px-4 py-2 text-sm">
            Total stay: <b>{nights}</b> night(s)
            {nights > 0 && <span className="text-slate-500"> · {f.pax || 0} pax = {nights * (Number(f.pax) || 0)} bed-nights required</span>}
          </div>
        </div>

        <div className="card">
          <label className="label">Remarks</label>
          <input className="input" value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save changes" : "Save group"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
