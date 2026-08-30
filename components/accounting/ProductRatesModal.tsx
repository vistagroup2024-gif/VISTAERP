"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

type Named = { id: string; name: string };
type CustRate = { id: string; party_id: string; sell_rate: number };
type SupRate = { id: string; account_id: string; purchase_rate: number };
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// Popup rate editor for a product: Default (sell/purchase for all), Customers
// (per-agent sell overrides), Suppliers (per-supplier purchase overrides).
export default function ProductRatesModal({ productId, productName, onClose }: {
  productId: string; productName: string; onClose: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState<"default" | "customers" | "suppliers" | "stock">("default");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [dSell, setDSell] = useState(""); const [dPur, setDPur] = useState("");
  const [isStock, setIsStock] = useState(false); const [uom, setUom] = useState(""); const [reorder, setReorder] = useState("");
  const [customers, setCustomers] = useState<Named[]>([]);
  const [suppliers, setSuppliers] = useState<Named[]>([]);
  const [custRates, setCustRates] = useState<CustRate[]>([]);
  const [supRates, setSupRates] = useState<SupRate[]>([]);
  const [newCust, setNewCust] = useState(""); const [newCustRate, setNewCustRate] = useState("");
  const [newSup, setNewSup] = useState(""); const [newSupRate, setNewSupRate] = useState("");

  const custName = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  async function reload() {
    const [{ data: p }, { data: cs }, { data: ss }, { data: cr }, { data: sr }] = await Promise.all([
      supabase.from("acct_products").select("sell_rate, purchase_rate, is_stock, uom, reorder_level").eq("id", productId).single(),
      supabase.from("parties").select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name"),
      supabase.from("accounts").select("id, name").eq("is_postable", true).eq("is_group", false).like("code", "2-01-%").order("code"),
      supabase.from("product_customer_rates").select("id, party_id, sell_rate").eq("product_id", productId),
      supabase.from("product_supplier_rates").select("id, account_id, purchase_rate").eq("product_id", productId),
    ]);
    if (p) {
      setDSell(String(Number(p.sell_rate))); setDPur(String(Number(p.purchase_rate)));
      setIsStock(!!p.is_stock); setUom(p.uom ?? ""); setReorder(String(Number(p.reorder_level ?? 0)));
    }
    setCustomers((cs as any[]) ?? []); setSuppliers((ss as any[]) ?? []);
    setCustRates((cr as any[]) ?? []); setSupRates((sr as any[]) ?? []);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [productId]);

  async function saveDefaults() {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("acct_products")
      .update({ sell_rate: Number(dSell) || 0, purchase_rate: Number(dPur) || 0 }).eq("id", productId);
    setBusy(false); if (error) return setErr(error.message); router.refresh();
  }
  async function addCust() {
    if (!newCust) return setErr("Pick a customer"); setBusy(true); setErr(null);
    const { error } = await supabase.from("product_customer_rates")
      .upsert({ company_id: COMPANY_ID, product_id: productId, party_id: newCust, sell_rate: Number(newCustRate) || 0 },
        { onConflict: "company_id,product_id,party_id" });
    setBusy(false); if (error) return setErr(error.message);
    setNewCust(""); setNewCustRate(""); reload(); router.refresh();
  }
  async function delCust(id: string) { await supabase.from("product_customer_rates").delete().eq("id", id); reload(); router.refresh(); }
  async function addSup() {
    if (!newSup) return setErr("Pick a supplier"); setBusy(true); setErr(null);
    const { error } = await supabase.from("product_supplier_rates")
      .upsert({ company_id: COMPANY_ID, product_id: productId, account_id: newSup, purchase_rate: Number(newSupRate) || 0 },
        { onConflict: "company_id,product_id,account_id" });
    setBusy(false); if (error) return setErr(error.message);
    setNewSup(""); setNewSupRate(""); reload(); router.refresh();
  }
  async function delSup(id: string) { await supabase.from("product_supplier_rates").delete().eq("id", id); reload(); router.refresh(); }
  async function saveStock() {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("acct_products")
      .update({ is_stock: isStock, uom: uom || null, reorder_level: Number(reorder) || 0 }).eq("id", productId);
    setBusy(false); if (error) return setErr(error.message); router.refresh();
  }

  const TabBtn = ({ id, label }: { id: typeof tab; label: string }) => (
    <button onClick={() => setTab(id)} className={`px-3 py-1.5 text-sm rounded-t ${tab === id ? "bg-white font-semibold text-brand border-x border-t border-slate-200" : "text-slate-500"}`}>{label}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-800">Rates — {productName}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="flex gap-1 border-b border-slate-200 bg-slate-50 px-4 pt-2">
          <TabBtn id="default" label="Default" /><TabBtn id="customers" label="Specific Customer" /><TabBtn id="suppliers" label="Specific Supplier" /><TabBtn id="stock" label="Stock" />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

          {tab === "default" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Sell Rate (all customers)</label>
                <input className="input text-right tabular-nums" inputMode="decimal" value={dSell} onChange={(e) => setDSell(e.target.value)} /></div>
              <div><label className="label">Purchase Rate (all suppliers)</label>
                <input className="input text-right tabular-nums" inputMode="decimal" value={dPur} onChange={(e) => setDPur(e.target.value)} /></div>
              <div className="col-span-2"><button onClick={saveDefaults} disabled={busy} className="btn">{busy ? "…" : "Save"}</button></div>
            </div>
          )}

          {tab === "customers" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-100 text-sm">
                {custRates.length === 0 ? <p className="p-3 text-slate-400">All customers use the default sell rate.</p> : (
                  <table className="w-full"><tbody>
                    {custRates.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="px-3 py-1.5 text-slate-700">{custName.get(r.party_id) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.sell_rate))}</td>
                        <td className="px-3 py-1.5 text-right"><button onClick={() => delCust(r.id)} className="text-xs text-red-600 hover:underline">Remove</button></td>
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
                <button onClick={addCust} disabled={busy} className="btn-outline text-sm">+ Add</button>
              </div>
            </div>
          )}

          {tab === "stock" && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isStock} onChange={(e) => setIsStock(e.target.checked)} /> This is a stock (inventory) item</label>
              {isStock && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Unit of measure</label><input className="input" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="e.g. pcs, kg, box" /></div>
                  <div><label className="label">Reorder level</label><input className="input text-right tabular-nums" inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} /></div>
                </div>
              )}
              <button onClick={saveStock} disabled={busy} className="btn">{busy ? "…" : "Save"}</button>
              <p className="text-xs text-slate-400">Stock items appear in Store → Stock Movement and carry quantity + value balances.</p>
            </div>
          )}

          {tab === "suppliers" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-100 text-sm">
                {supRates.length === 0 ? <p className="p-3 text-slate-400">All suppliers use the default purchase rate.</p> : (
                  <table className="w-full"><tbody>
                    {supRates.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="px-3 py-1.5 text-slate-700">{supName.get(r.account_id) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(Number(r.purchase_rate))}</td>
                        <td className="px-3 py-1.5 text-right"><button onClick={() => delSup(r.id)} className="text-xs text-red-600 hover:underline">Remove</button></td>
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
                <button onClick={addSup} disabled={busy} className="btn-outline text-sm">+ Add</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
