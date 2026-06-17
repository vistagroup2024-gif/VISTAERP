"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, money } from "@/lib/format";

type Pax = { full_name: string; passport_no: string; nationality: string };

export default function NewBookingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [customers, setCustomers] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [sellCurrency, setSellCurrency] = useState("PKR");
  const [paxList, setPaxList] = useState<Pax[]>([{ full_name: "", passport_no: "", nationality: "" }]);
  const [pkgItems, setPkgItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("parties").select("id, name, party_type").in("party_type", ["customer", "b2b_agent"]).order("name")
      .then(({ data }) => setCustomers(data ?? []));
    supabase.from("packages").select("id, name").eq("status", "active").order("name")
      .then(({ data }) => setPackages(data ?? []));
  }, [supabase]);

  useEffect(() => {
    if (!packageId) return setPkgItems([]);
    supabase.from("package_items").select("*").eq("package_id", packageId).order("sort_order")
      .then(({ data }) => setPkgItems(data ?? []));
  }, [packageId, supabase]);

  const pax = paxList.length;
  const perPaxSell = pkgItems.reduce((s, i) => s + Number(i.sell_price) * Number(i.qty), 0);
  const totalSell = perPaxSell * pax;

  function updatePax(i: number, patch: Partial<Pax>) {
    setPaxList(paxList.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { data: bookingNo, error: numErr } = await supabase.rpc("next_doc_number", {
      p_company: COMPANY_ID,
      p_doc_type: "booking",
    });
    if (numErr) { setSaving(false); return setError(numErr.message); }

    const { data: booking, error: bErr } = await supabase
      .from("bookings")
      .insert({
        company_id: COMPANY_ID,
        booking_no: bookingNo,
        customer_id: customerId,
        package_id: packageId || null,
        travel_date: travelDate || null,
        return_date: returnDate || null,
        pax_count: pax,
        sell_currency: sellCurrency,
        total_sell: totalSell,
        total_cost: 0,
        status: "held",
      })
      .select("id")
      .single();
    if (bErr || !booking) { setSaving(false); return setError(bErr?.message ?? "Failed"); }

    const { error: pErr } = await supabase.from("booking_pax").insert(
      paxList.filter((p) => p.full_name).map((p) => ({
        booking_id: booking.id,
        full_name: p.full_name,
        passport_no: p.passport_no || null,
        nationality: p.nationality || null,
      }))
    );
    if (pErr) { setSaving(false); return setError(pErr.message); }

    if (pkgItems.length) {
      const { error: iErr } = await supabase.from("booking_items").insert(
        pkgItems.map((i) => ({
          booking_id: booking.id,
          service_type: i.service_type,
          description: i.description,
          supplier_id: i.supplier_id,
          hotel_id: i.hotel_id,
          qty: pax,
          nights: i.nights,
          cost_currency: i.cost_currency,
          cost_price: i.cost_price,
          sell_currency: sellCurrency,
          sell_price: i.sell_price,
        }))
      );
      if (iErr) { setSaving(false); return setError(iErr.message); }
    }

    router.push(`/bookings/${booking.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">New Booking</h1>
      <form onSubmit={save} className="space-y-6">
        {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="card grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Customer / Agent</label>
            <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Select…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.party_type})</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Package</label>
            <select className="input" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">— None (ad-hoc) —</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Travel date</label>
            <input className="input" type="date" value={travelDate} onChange={(e) => setTravelDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Return date</label>
            <input className="input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Sell currency</label>
            <select className="input" value={sellCurrency} onChange={(e) => setSellCurrency(e.target.value)}>
              <option>PKR</option><option>SAR</option><option>USD</option><option>AED</option>
            </select>
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Passengers ({pax})</h2>
            <button type="button" className="btn-outline" onClick={() => setPaxList([...paxList, { full_name: "", passport_no: "", nationality: "" }])}>+ Add pax</button>
          </div>
          <div className="space-y-2">
            {paxList.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input className="input col-span-5" placeholder="Full name" value={p.full_name} onChange={(e) => updatePax(i, { full_name: e.target.value })} />
                <input className="input col-span-4" placeholder="Passport #" value={p.passport_no} onChange={(e) => updatePax(i, { passport_no: e.target.value })} />
                <input className="input col-span-2" placeholder="Nationality" value={p.nationality} onChange={(e) => updatePax(i, { nationality: e.target.value })} />
                <button type="button" className="col-span-1 text-red-500" onClick={() => setPaxList(paxList.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
          </div>
        </div>

        {pkgItems.length > 0 && (
          <div className="card">
            <h2 className="mb-3 font-semibold">Package components (per pax)</h2>
            <ul className="divide-y divide-slate-100 text-sm">
              {pkgItems.map((i) => (
                <li key={i.id} className="flex justify-between py-2">
                  <span className="capitalize">{i.service_type.replace("_", " ")} — {i.description}</span>
                  <span>{money(i.sell_price, sellCurrency)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="card flex items-center justify-between">
          <span className="text-slate-500">Estimated total ({pax} pax × {money(perPaxSell, sellCurrency)})</span>
          <span className="text-xl font-bold text-brand-dark">{money(totalSell, sellCurrency)}</span>
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Create booking"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
