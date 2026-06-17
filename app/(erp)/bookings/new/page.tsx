"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, money } from "@/lib/format";

type Pax = { full_name: string; passport_no: string; nationality: string; visa_type: string };
type Line = {
  service_id: string | null;
  service_type: string;
  description: string;
  qty: number;
  cost_currency: string;
  cost_price: number;
  sell_price: number; // in booking sell currency
};

function deriveCategory(lines: Line[]): string {
  const types = new Set(lines.map((l) => l.service_type));
  if (types.size === 1 && types.has("visa")) return "visa_only";
  if (types.size <= 2 && types.has("visa") && types.has("transport")) return "visa_transport";
  if (types.has("hotel") && lines.length >= 3) return "package";
  return "custom";
}

export default function NewBookingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [customers, setCustomers] = useState<any[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [travelDate, setTravelDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [sellCurrency, setSellCurrency] = useState("PKR");
  const [paxList, setPaxList] = useState<Pax[]>([{ full_name: "", passport_no: "", nationality: "", visa_type: "" }]);
  const [lines, setLines] = useState<Line[]>([]);
  const [pickService, setPickService] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("parties").select("id, name, party_type").in("party_type", ["customer", "b2b_agent"]).order("name").then(({ data }) => setCustomers(data ?? []));
    supabase.from("packages").select("id, name").eq("status", "active").order("name").then(({ data }) => setPackages(data ?? []));
    supabase.from("service_catalog").select("*").eq("is_active", true).order("service_type").then(({ data }) => setCatalog(data ?? []));
  }, [supabase]);

  const pax = paxList.length;

  function updatePax(i: number, patch: Partial<Pax>) {
    setPaxList(paxList.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  // Add a catalog service as a line, resolving the customer's negotiated price.
  async function addCatalogService(serviceId: string) {
    const svc = catalog.find((s) => s.id === serviceId);
    if (!svc) return;
    let price = svc.list_price;
    if (customerId) {
      const { data } = await supabase.rpc("get_service_price", { p_party: customerId, p_service: serviceId });
      if (data != null) price = Number(data);
    }
    setLines((prev) => [...prev, {
      service_id: svc.id,
      service_type: svc.service_type,
      description: svc.name,
      qty: pax || 1,
      cost_currency: svc.cost_currency,
      cost_price: svc.default_cost,
      sell_price: price,
    }]);
    setPickService("");
  }

  function addBlankLine() {
    setLines([...lines, { service_id: null, service_type: "other", description: "", qty: 1, cost_currency: "SAR", cost_price: 0, sell_price: 0 }]);
  }

  async function applyPackage(pid: string) {
    setPackageId(pid);
    if (!pid) return;
    const { data: items } = await supabase.from("package_items").select("*").eq("package_id", pid).order("sort_order");
    setLines((items ?? []).map((i: any) => ({
      service_id: null,
      service_type: i.service_type,
      description: i.description,
      qty: pax || 1,
      cost_currency: i.cost_currency,
      cost_price: i.cost_price,
      sell_price: i.sell_price,
    })));
  }

  const total = lines.reduce((s, l) => s + Number(l.sell_price) * Number(l.qty), 0);
  const category = deriveCategory(lines);
  const hasVisa = lines.some((l) => l.service_type === "visa");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) return setError("Add at least one service line.");
    setSaving(true);
    setError(null);

    const { data: bookingNo, error: numErr } = await supabase.rpc("next_doc_number", { p_company: COMPANY_ID, p_doc_type: "booking" });
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
        total_sell: total,
        total_cost: 0,
        category,
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
        visa_type: p.visa_type || null,
      }))
    );
    if (pErr) { setSaving(false); return setError(pErr.message); }

    const { error: iErr } = await supabase.from("booking_items").insert(
      lines.map((l) => ({
        booking_id: booking.id,
        service_id: l.service_id,
        service_type: l.service_type,
        description: l.description,
        qty: l.qty,
        cost_currency: l.cost_currency,
        cost_price: l.cost_price,
        sell_currency: sellCurrency,
        sell_price: l.sell_price,
      }))
    );
    if (iErr) { setSaving(false); return setError(iErr.message); }

    router.push(`/bookings/${booking.id}`);
    router.refresh();
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-bold">New Sales Order</h1>
      <p className="mb-6 text-sm text-slate-500">Sell anything from a single visa to a full package. Prices auto-fill from the customer's rate or the list price.</p>
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
          <div>
            <label className="label">Use a package template (optional)</label>
            <select className="input" value={packageId} onChange={(e) => applyPackage(e.target.value)}>
              <option value="">— None —</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Services <span className="ml-2 text-xs font-normal capitalize text-slate-400">({category.replace("_", " ")})</span></h2>
            <div className="flex items-center gap-2">
              <select className="input" value={pickService} onChange={(e) => { setPickService(e.target.value); if (e.target.value) addCatalogService(e.target.value); }}>
                <option value="">+ Add from catalog…</option>
                {catalog.map((s) => <option key={s.id} value={s.id}>{s.name} ({money(s.list_price, s.sell_currency)})</option>)}
              </select>
              <button type="button" className="btn-outline" onClick={addBlankLine}>+ Blank line</button>
            </div>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <select className="input col-span-2" value={l.service_type} onChange={(e) => updateLine(i, { service_type: e.target.value })}>
                  <option value="visa">Visa</option>
                  <option value="transport">Transport</option>
                  <option value="hotel">Hotel</option>
                  <option value="air_ticket">Air ticket</option>
                  <option value="insurance">Insurance</option>
                  <option value="ziyarat">Ziyarat</option>
                  <option value="other">Other</option>
                </select>
                <input className="input col-span-5" placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} required />
                <input className="input col-span-1" type="number" title="Qty" value={l.qty} onChange={(e) => updateLine(i, { qty: Number(e.target.value) })} />
                <input className="input col-span-3" type="number" placeholder={`Sell (${sellCurrency})`} value={l.sell_price} onChange={(e) => updateLine(i, { sell_price: Number(e.target.value) })} />
                <button type="button" className="col-span-1 text-red-500" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
            {lines.length === 0 && <p className="text-sm text-slate-400">No services yet — add from the catalog or a package template.</p>}
          </div>
          <div className="mt-4 flex justify-end text-lg">
            <span className="text-slate-500">Total:&nbsp;</span>
            <span className="font-bold text-brand-dark">{money(total, sellCurrency)}</span>
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Passengers ({pax})</h2>
            <button type="button" className="btn-outline" onClick={() => setPaxList([...paxList, { full_name: "", passport_no: "", nationality: "", visa_type: "" }])}>+ Add pax</button>
          </div>
          <div className="space-y-2">
            {paxList.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input className="input col-span-4" placeholder="Full name" value={p.full_name} onChange={(e) => updatePax(i, { full_name: e.target.value })} />
                <input className="input col-span-3" placeholder="Passport #" value={p.passport_no} onChange={(e) => updatePax(i, { passport_no: e.target.value })} />
                <input className="input col-span-2" placeholder="Nationality" value={p.nationality} onChange={(e) => updatePax(i, { nationality: e.target.value })} />
                {hasVisa && (
                  <input className="input col-span-2" placeholder="Visa type" value={p.visa_type} onChange={(e) => updatePax(i, { visa_type: e.target.value })} />
                )}
                <button type="button" className={`${hasVisa ? "col-span-1" : "col-span-3"} text-red-500`} onClick={() => setPaxList(paxList.filter((_, idx) => idx !== i))}>✕</button>
              </div>
            ))}
          </div>
          {hasVisa && <p className="mt-2 text-xs text-slate-400">Visa status per passenger is tracked on the booking after creation.</p>}
        </div>

        <div className="flex gap-2">
          <button className="btn" disabled={saving}>{saving ? "Saving…" : "Create order"}</button>
          <button type="button" className="btn-outline" onClick={() => router.back()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
