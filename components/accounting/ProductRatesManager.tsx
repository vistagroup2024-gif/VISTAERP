"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Product = { id: string; name: string; purchase_rate: number; sell_rate: number };
type Named = { id: string; name: string; code?: string };
type CustRate = { id: string; product_id: string; party_id: string; sell_rate: number };
type SupRate = { id: string; product_id: string; account_id: string; purchase_rate: number };

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Rates for a product: a default sell rate (all customers) + default purchase rate,
// then per-agent sell overrides and per-supplier purchase overrides. Drives the
// automatic Visa invoice pricing.
export default function ProductRatesManager({ products, customers, suppliers, custRates, supRates }: {
  products: Product[]; customers: Named[]; suppliers: Named[]; custRates: CustRate[]; supRates: SupRate[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pid, setPid] = useState(products[0]?.id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const product = useMemo(() => products.find((p) => p.id === pid), [products, pid]);
  const [dSell, setDSell] = useState("");
  const [dPur, setDPur] = useState("");
  // sync default inputs when product changes
  const [lastPid, setLastPid] = useState("");
  if (pid !== lastPid) {
    setLastPid(pid);
    setDSell(product ? String(Number(product.sell_rate)) : "");
    setDPur(product ? String(Number(product.purchase_rate)) : "");
  }

  const custName = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const myCust = useMemo(() => custRates.filter((r) => r.product_id === pid), [custRates, pid]);
  const mySup = useMemo(() => supRates.filter((r) => r.product_id === pid), [supRates, pid]);

  const [newCust, setNewCust] = useState(""); const [newCustRate, setNewCustRate] = useState("");
  const [newSup, setNewSup] = useState(""); const [newSupRate, setNewSupRate] = useState("");

  async function saveDefaults() {
    if (!pid) return; setErr(null); setBusy(true);
    const { error } = await supabase.from("acct_products")
      .update({ sell_rate: Number(dSell) || 0, purchase_rate: Number(dPur) || 0 }).eq("id", pid);
    setBusy(false); if (error) return setErr(error.message); router.refresh();
  }
  async function addCustOverride() {
    if (!pid || !newCust) return setErr("Pick a customer");
    setErr(null); setBusy(true);
    const { error } = await supabase.from("product_customer_rates")
      .upsert({ company_id: COMPANY_ID, product_id: pid, party_id: newCust, sell_rate: Number(newCustRate) || 0 },
        { onConflict: "company_id,product_id,party_id" });
    setBusy(false); if (error) return setErr(error.message);
    setNewCust(""); setNewCustRate(""); router.refresh();
  }
  async function editCust(r: CustRate) {
    const v = prompt(`Sell rate for ${custName.get(r.party_id) ?? "customer"}:`, String(Number(r.sell_rate))); if (v === null) return;
    await supabase.from("product_customer_rates").update({ sell_rate: Number(v) || 0 }).eq("id", r.id); router.refresh();
  }
  async function delCust(r: CustRate) {
    await supabase.from("product_customer_rates").delete().eq("id", r.id); router.refresh();
  }
  async function addSupOverride() {
    if (!pid || !newSup) return setErr("Pick a supplier");
    setErr(null); setBusy(true);
    const { error } = await supabase.from("product_supplier_rates")
      .upsert({ company_id: COMPANY_ID, product_id: pid, account_id: newSup, purchase_rate: Number(newSupRate) || 0 },
        { onConflict: "company_id,product_id,account_id" });
    setBusy(false); if (error) return setErr(error.message);
    setNewSup(""); setNewSupRate(""); router.refresh();
  }
  async function editSup(r: SupRate) {
    const v = prompt(`Purchase rate for ${supName.get(r.account_id) ?? "supplier"}:`, String(Number(r.purchase_rate))); if (v === null) return;
    await supabase.from("product_supplier_rates").update({ purchase_rate: Number(v) || 0 }).eq("id", r.id); router.refresh();
  }
  async function delSup(r: SupRate) {
    await supabase.from("product_supplier_rates").delete().eq("id", r.id); router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Set the default Sell rate (applies to all customers) and default Purchase rate (all suppliers) per product, then
        add per-agent or per-supplier overrides for exceptions. For UMRAH VISA (NON MASAR), stays over 20 nights add SAR 3
        per extra night to the sell rate automatically.
      </p>

      <div className="card space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3"><label className="label">Product</label>
            <select className="input" value={pid} onChange={(e) => setPid(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="label">Default Sell Rate (all customers)</label>
            <input className="input text-right tabular-nums" inputMode="decimal" value={dSell} onChange={(e) => setDSell(e.target.value)} /></div>
          <div><label className="label">Default Purchase Rate (all suppliers)</label>
            <input className="input text-right tabular-nums" inputMode="decimal" value={dPur} onChange={(e) => setDPur(e.target.value)} /></div>
          <div className="flex items-end"><button onClick={saveDefaults} disabled={busy || !pid} className="btn w-full">{busy ? "…" : "Save defaults"}</button></div>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h3 className="font-semibold text-slate-700">Customer sell overrides</h3>
          <div className="rounded-lg border border-slate-100 text-sm">
            {myCust.length === 0 ? <p className="p-3 text-slate-400">All customers use the default {product ? money(Number(product.sell_rate)) : ""}.</p> : (
              <table className="w-full"><tbody>
                {myCust.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="px-3 py-1.5 text-slate-700">{custName.get(r.party_id) ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.sell_rate))}</td>
                    <td className="px-3 py-1.5 text-right text-xs">
                      <button onClick={() => editCust(r)} className="text-brand hover:underline">Edit</button>
                      <button onClick={() => delCust(r)} className="ml-2 text-red-600 hover:underline">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
          <div className="flex gap-2">
            <select className="input" value={newCust} onChange={(e) => setNewCust(e.target.value)}>
              <option value="">Add customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="input w-28 text-right tabular-nums" inputMode="decimal" placeholder="rate" value={newCustRate} onChange={(e) => setNewCustRate(e.target.value)} />
            <button onClick={addCustOverride} disabled={busy} className="btn-outline text-sm">+ Add</button>
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-slate-700">Supplier purchase overrides</h3>
          <div className="rounded-lg border border-slate-100 text-sm">
            {mySup.length === 0 ? <p className="p-3 text-slate-400">All suppliers use the default {product ? money(Number(product.purchase_rate)) : ""}.</p> : (
              <table className="w-full"><tbody>
                {mySup.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="px-3 py-1.5 text-slate-700">{supName.get(r.account_id) ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.purchase_rate))}</td>
                    <td className="px-3 py-1.5 text-right text-xs">
                      <button onClick={() => editSup(r)} className="text-brand hover:underline">Edit</button>
                      <button onClick={() => delSup(r)} className="ml-2 text-red-600 hover:underline">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
          <div className="flex gap-2">
            <select className="input" value={newSup} onChange={(e) => setNewSup(e.target.value)}>
              <option value="">Add supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input className="input w-28 text-right tabular-nums" inputMode="decimal" placeholder="rate" value={newSupRate} onChange={(e) => setNewSupRate(e.target.value)} />
            <button onClick={addSupOverride} disabled={busy} className="btn-outline text-sm">+ Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}
