"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import SearchSelect from "@/components/ui/SearchSelect";

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
  const [tab, setTab] = useState<"default" | "costing" | "customers" | "suppliers" | "stock">("default");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [dSell, setDSell] = useState(""); const [dPur, setDPur] = useState(""); const [dExp, setDExp] = useState("");
  const [isStock, setIsStock] = useState(false); const [uom, setUom] = useState(""); const [reorder, setReorder] = useState(""); const [reorderQty, setReorderQty] = useState("");
  const [customers, setCustomers] = useState<Named[]>([]);
  const [suppliers, setSuppliers] = useState<Named[]>([]);
  const [custRates, setCustRates] = useState<CustRate[]>([]);
  const [supRates, setSupRates] = useState<SupRate[]>([]);
  const [newCust, setNewCust] = useState(""); const [newCustRate, setNewCustRate] = useState("");
  const [newSup, setNewSup] = useState(""); const [newSupRate, setNewSupRate] = useState("");
  // Costing: the expense heads, and what this item costs under each. The heads
  // are the Car Purchase Expense master — the same list the Car Expense voucher
  // offers — so what a car is expected to cost is described in the vocabulary
  // its actual costs arrive in.
  const [heads, setHeads] = useState<Named[]>([]);
  const [costs, setCosts] = useState<Record<string, string>>({});

  // Purchase rate plus every head. Derived, never typed — a total anyone can
  // type is a total that can disagree with the parts above it.
  const costingTotal = useMemo(
    () => (Number(dPur) || 0) + heads.reduce((s2, h) => s2 + (Number(costs[h.id]) || 0), 0),
    [dPur, heads, costs]);
  const custName = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const supName = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);

  async function reload() {
    const [{ data: p }, { data: cs }, { data: ss }, { data: cr }, { data: sr }, { data: hd }, { data: pc }] = await Promise.all([
      supabase.from("acct_products").select("sell_rate, purchase_rate, expense_rate, is_stock, uom, reorder_level, reorder_qty").eq("id", productId).single(),
      supabase.from("parties").select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name"),
      supabase.from("accounts").select("id, name").eq("is_postable", true).eq("is_group", false).like("code", "2-01-%").order("code"),
      supabase.from("product_customer_rates").select("id, party_id, sell_rate").eq("product_id", productId),
      supabase.from("product_supplier_rates").select("id, account_id, purchase_rate").eq("product_id", productId),
      supabase.from("acct_car_purchase_expenses").select("id, name").eq("is_active", true).order("name"),
      supabase.from("acct_product_costing").select("expense_id, amount").eq("product_id", productId),
    ]);
    setHeads((hd as any[]) ?? []);
    setCosts(Object.fromEntries(((pc as any[]) ?? []).map((r) => [r.expense_id, String(Number(r.amount))])));
    if (p) {
      setDSell(String(Number(p.sell_rate))); setDPur(String(Number(p.purchase_rate)));
      setDExp(String(Number(p.expense_rate ?? 0)));
      setIsStock(!!p.is_stock); setUom(p.uom ?? ""); setReorder(String(Number(p.reorder_level ?? 0))); setReorderQty(String(Number(p.reorder_qty ?? 0)));
    }
    setCustomers((cs as any[]) ?? []); setSuppliers((ss as any[]) ?? []);
    setCustRates((cr as any[]) ?? []); setSupRates((sr as any[]) ?? []);
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [productId]);

  async function saveDefaults() {
    setBusy(true); setErr(null);
    const { error } = await supabase.from("acct_products")
      .update({ sell_rate: Number(dSell) || 0, purchase_rate: Number(dPur) || 0 })
      .eq("id", productId);
    setBusy(false); if (error) return setErr(error.message);
    router.refresh(); onClose();
  }

  // Purchase rate and every head go together, through the one routine, so a
  // half-saved cost cannot become the figure the next quotation prices from.
  async function saveCosting() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("product_costing_save", {
      p_product: productId,
      p_purchase_rate: Number(dPur) || 0,
      p_lines: heads.map((h) => ({ expense_id: h.id, amount: Number(costs[h.id]) || 0 })),
    });
    setBusy(false); if (error) return setErr(error.message);
    router.refresh(); onClose();
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
      .update({ is_stock: isStock, uom: uom || null, reorder_level: Number(reorder) || 0, reorder_qty: Number(reorderQty) || 0 }).eq("id", productId);
    setBusy(false); if (error) return setErr(error.message);
    router.refresh(); onClose();
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
          <TabBtn id="default" label="Default" /><TabBtn id="costing" label="Costing" /><TabBtn id="customers" label="Specific Customer" /><TabBtn id="suppliers" label="Specific Supplier" /><TabBtn id="stock" label="Stock" />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          {err && <p className="mb-2 text-sm text-red-600">{err}</p>}

          {tab === "default" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Sell Rate (all customers)</label>
                <input className="input text-right tabular-nums" inputMode="decimal" value={dSell} onChange={(e) => setDSell(e.target.value)} /></div>
              <div><label className="label">Purchase Rate (all suppliers)</label>
                <input className="input text-right tabular-nums" inputMode="decimal" value={dPur} onChange={(e) => setDPur(e.target.value)} /></div>
              {/* Expenses is READ-ONLY here. It is the sum of the Costing tab's
                  heads, kept by the database, so typing a different number here
                  would be a second door to one figure — and the losing one, as
                  the next costing save overwrites it. Total is added up rather
                  than typed for the same reason. */}
              <div><label className="label">Expenses <span className="ml-1 font-normal normal-case text-slate-400">· from Costing</span></label>
                <div className="input flex items-center justify-end bg-slate-50 tabular-nums text-slate-600">{money(Number(dExp) || 0)}</div></div>
              <div>
                <label className="label">Total Cost <span className="ml-1 font-normal normal-case text-slate-400">· purchase + expenses</span></label>
                <div className="input flex items-center justify-end bg-slate-50 tabular-nums text-slate-600">
                  {money((Number(dPur) || 0) + (Number(dExp) || 0))}
                </div>
              </div>
              <p className="col-span-2 -mt-1 text-xs text-slate-400">
                The Purchase Order checks a supplier&rsquo;s price against the <b>Purchase Rate</b> — the expenses are not the
                supplier&rsquo;s to charge. A car Sales Quotation quotes its margin on the <b>Total Cost</b>.
                Break the expenses down on the <b>Costing</b> tab.
              </p>
              <div className="col-span-2"><button onClick={saveDefaults} disabled={busy} className="btn">{busy ? "…" : "Save"}</button></div>
            </div>
          )}

          {tab === "costing" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                What this item costs, head by head. The heads are the{" "}
                <b>Car Purchase Expense</b> master — the same list a Car Expense voucher offers — so what a
                vehicle is expected to cost and what it actually costs are written in one vocabulary.
                Add or rename a head in Masters &rarr; Car Purchase Expenses and it appears here.
              </p>
              <div className="rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-700">Purchase Rate</td>
                      <td className="px-3 py-2 text-right">
                        <input className="input w-40 text-right tabular-nums" inputMode="decimal"
                          value={dPur} onChange={(e) => setDPur(e.target.value)} placeholder="0.00" />
                      </td>
                    </tr>
                    {heads.map((h) => (
                      <tr key={h.id} className="border-b border-slate-100">
                        <td className="px-3 py-2 text-slate-600">{h.name}</td>
                        <td className="px-3 py-2 text-right">
                          <input className="input w-40 text-right tabular-nums" inputMode="decimal"
                            value={costs[h.id] ?? ""} placeholder="0.00"
                            onChange={(e) => setCosts((c) => ({ ...c, [h.id]: e.target.value }))} />
                        </td>
                      </tr>
                    ))}
                    {heads.length === 0 && (
                      <tr><td colSpan={2} className="px-3 py-6 text-center text-slate-400">
                        No expense heads yet — add them in Masters &rarr; Car Purchase Expenses.
                      </td></tr>
                    )}
                    <tr className="bg-slate-50">
                      <td className="px-3 py-2 font-semibold text-slate-700">Total</td>
                      <td className="px-3 py-2 text-right text-base font-bold tabular-nums text-brand">
                        {money(costingTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400">
                This Total is the item&rsquo;s <b>Total Cost</b>, and it is what a car Sales Quotation
                fills <b>Total Cost (COGS)</b> from — the figure the margin, the selling price and the
                whole instalment calculation are worked out from.
              </p>
              <button onClick={saveCosting} disabled={busy} className="btn disabled:opacity-40">
                {busy ? "Saving…" : "Save costing"}
              </button>
            </div>
          )}

          {tab === "customers" && (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-lg border border-slate-100 text-sm">
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
                <SearchSelect value={newCust} onChange={setNewCust} placeholder="Add customer…" options={customers.map((c) => ({ value: c.id, label: c.name }))} />
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
                  <div><label className="label">Reorder level</label><input className="input text-right tabular-nums" inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} />
                    <p className="mt-1 text-xs text-slate-400">Fall to this and the item shows on the Reorder Report.</p></div>
                  <div><label className="label">Reorder quantity</label><input className="input text-right tabular-nums" inputMode="decimal" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} />
                    <p className="mt-1 text-xs text-slate-400">How many to buy when it does. Left at 0, the indent asks for just enough to reach the level.</p></div>
                </div>
              )}
              <button onClick={saveStock} disabled={busy} className="btn">{busy ? "…" : "Save"}</button>
              <p className="text-xs text-slate-400">Stock items appear throughout the Inventory module and carry quantity + value balances.</p>
            </div>
          )}

          {tab === "suppliers" && (
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-lg border border-slate-100 text-sm">
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
                <SearchSelect value={newSup} onChange={setNewSup} placeholder="Add supplier…" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
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
