"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, money } from "@/lib/format";

type Rate = { id: string; price: number; currency: string; parties: { name: string } | null };

export default function CustomerRatesManager({
  serviceId,
  defaultCurrency,
  initial,
  customers,
}: {
  serviceId: string;
  defaultCurrency: string;
  initial: Rate[];
  customers: { id: string; name: string; party_type: string }[];
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Rate[]>(initial);
  const [partyId, setPartyId] = useState("");
  const [price, setPrice] = useState(0);
  const [currency, setCurrency] = useState(defaultCurrency);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { data, error } = await supabase
      .from("customer_rates")
      .insert({ company_id: COMPANY_ID, party_id: partyId, service_id: serviceId, price, currency })
      .select("id, price, currency, parties:party_id(name)")
      .single();
    if (error) return setError(error.message);
    setRows([...rows, data as any]);
    setPartyId("");
    setPrice(0);
  }

  async function remove(id: string) {
    await supabase.from("customer_rates").delete().eq("id", id);
    setRows(rows.filter((r) => r.id !== id));
  }

  return (
    <div className="card">
      <h2 className="mb-3 font-semibold">Per-customer rates</h2>
      <p className="mb-3 text-sm text-slate-500">Negotiated prices override the list price for that customer on new orders.</p>
      {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <ul className="mb-4 divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2 text-sm">
            <span>{r.parties?.name}</span>
            <span className="flex items-center gap-3">
              <b>{money(r.price, r.currency)}</b>
              <button onClick={() => remove(r.id)} className="text-red-500">✕</button>
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="py-2 text-sm text-slate-400">No custom rates — all customers use the list price.</li>}
      </ul>
      <form onSubmit={add} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label">Customer / Agent</label>
          <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)} required>
            <option value="">Select…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.party_type})</option>)}
          </select>
        </div>
        <div className="w-32">
          <label className="label">Price</label>
          <input className="input" type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} required />
        </div>
        <div className="w-24">
          <label className="label">Cur</label>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option>PKR</option><option>SAR</option><option>USD</option><option>AED</option>
          </select>
        </div>
        <button className="btn">Add</button>
      </form>
    </div>
  );
}
