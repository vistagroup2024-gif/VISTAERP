"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, money } from "@/lib/format";

type Line = { description: string; qty: number; unit_price: number };
const blank: Line = { description: "", qty: 1, unit_price: 0 };

export default function NewBillPage() {
  const router = useRouter();
  const supabase = createClient();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("SAR");
  const [fxRate, setFxRate] = useState(75);
  const [tax, setTax] = useState(0);
  const [lines, setLines] = useState<Line[]>([{ ...blank }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("parties").select("id, name").eq("party_type", "supplier").order("name").then(({ data }) => setSuppliers(data ?? []));
    supabase.from("bookings").select("id, booking_no").order("created_at", { ascending: false }).limit(100).then(({ data }) => setBookings(data ?? []));
  }, [supabase]);

  function update(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const subtotal = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
  const total = subtotal + Number(tax);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { data: no, error: nErr } = await supabase.rpc("next_doc_number", { p_company: COMPANY_ID, p_doc_type: "bill" });
    if (nErr) { setSaving(false); return setError(nErr.message); }

    const { data: bill, error: bErr } = await supabase
      .from("bills")
      .insert({
        company_id: COMPANY_ID,
        bill_no: no,
        supplier_id: supplierId,
        booking_id: bookingId || null,
        bill_date: billDate,
        currency,
        fx_rate: Number(fxRate),
        subtotal,
        tax_amount: Number(tax),
        total,
        status: "issued",
      })
      .select("id")
      .single();
    if (bErr || !bill) { setSaving(false); return setError(bErr?.message ?? "Failed"); }

    const { error: lErr } = await supabase.from("bill_lines").insert(
      lines.filter((l) => l.description).map((l) => ({
        bill_id: bill.id,
        description: l.description,
        qty: Number(l.qty),
        unit_price: Number(l.unit_price),
        line_total: Number(l.qty) * Number(l.unit_price),
      }))
    );
    if (lErr) { setSaving(false); return setError(lErr.message); }

    router.push(`/purchase/bills/${bill.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">New Supplier Bill</h1>
      <form onSubmit={save} className="space-y-4">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="card grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Supplier</label>
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
              <option value="">Select…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Link to booking (optional)</label>
            <select className="input" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
              <option value="">— None —</option>
              {bookings.map((b) => <option key={b.id} value={b.id}>{b.booking_no}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Bill date</label>
            <input className="input" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Currency</label>
              <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option>SAR</option><option>USD</option><option>PKR</option><option>AED</option>
              </select>
            </div>
            <div>
              <label className="label">FX → PKR</label>
              <input className="input" type="number" step="0.0001" value={fxRate} onChange={(e) => setFxRate(Number(e.target.value))} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Lines ({currency})</h2>
            <button type="button" className="btn-outline" onClick={() => setLines([...lines, { ...blank }])}>+ Add line</button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input className="input col-span-7" placeholder="Description (e.g. Makkah hotel 9 nights)" value={l.description} onChange={(e) => update(i, { description: e.target.value })} />
                <input className="input col-span-2" type="number" placeholder="Qty" value={l.qty} onChange={(e) => update(i, { qty: Number(e.target.value) })} />
                <input className="input col-span-3" type="number" placeholder="Unit price" value={l.unit_price} onChange={(e) => update(i, { unit_price: Number(e.target.value) })} />
              </div>
            ))}
          </div>
          <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(subtotal, currency)}</span></div>
            <div className="flex items-center justify-between">
              <span>Tax</span>
              <input className="input w-28 text-right" type="number" value={tax} onChange={(e) => setTax(Number(e.target.value))} />
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><span>Total</span><span>{money(total, currency)}</span></div>
            <div className="flex justify-between text-slate-400"><span>≈ in PKR</span><span>{money(total * fxRate, "PKR")}</span></div>
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Save bill"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
