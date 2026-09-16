"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { COMPANY_ID } from "@/lib/format";
import { todaySA, yearSA, monthStartSA } from "@/lib/saudiTime";
import type { Need } from "@/lib/reports/types";
import SearchSelect, { type SearchOption } from "@/components/ui/SearchSelect";
import MultiSearchSelect, { type MultiOption } from "@/components/ui/MultiSearchSelect";
import AccountPickTree, { type PickNode } from "@/components/accounting/AccountPickTree";
import CostCenterPickTree from "./pickers/CostCenterPickTree";
import TagAreaPickTree from "./pickers/TagAreaPickTree";
import ItemPickTree, { type QtyNode } from "./pickers/ItemPickTree";

export interface Filters {
  from: string; to: string; asof: string; month: number; year: number;
  items: string[] | null; itemGroup: string[] | null; warehouse: string | null;
  costCenter: string[] | null; tagArea: string[] | null;
  account: string[] | null; accountGroup: string[] | null;
  party: string[] | null; product: string[] | null; productGroup: string[] | null;
  vehicle: string[] | null; driver: string[] | null; route: string[] | null;
  status: string[] | null; txnType: string[] | null; currency: string | null;
  movedOnly: boolean; mode?: string; limit: number; search: string;
}

export function defaultReportFilters(): Filters {
  const today = todaySA();
  return {
    from: `${yearSA()}-01-01`, to: today, asof: today, month: Number(today.slice(5, 7)), year: yearSA(),
    items: null, itemGroup: null, warehouse: null,
    costCenter: null, tagArea: null, account: null, accountGroup: null,
    party: null, product: null, productGroup: null,
    vehicle: null, driver: null, route: null,
    status: null, txnType: null, currency: null,
    movedOnly: false, limit: 50, search: "",
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const RANGES: Record<string, () => [string, string]> = {
  "Custom": () => [`${yearSA()}-01-01`, todaySA()],
  "Today": () => [todaySA(), todaySA()],
  "This Week": () => {
    const t = new Date(todaySA() + "T00:00:00Z");
    const dow = t.getUTCDay();                        // 0 = Sunday
    const start = new Date(t); start.setUTCDate(t.getUTCDate() - dow);
    return [start.toISOString().slice(0, 10), todaySA()];
  },
  "This Month": () => [monthStartSA(), todaySA()],
  "Last Month": () => {
    const t = todaySA(), y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(last)}`];
  },
  "This Year": () => [`${yearSA()}-01-01`, todaySA()],
  "Last Year": () => [`${yearSA() - 1}-01-01`, `${yearSA() - 1}-12-31`],
  "Year to Date": () => [`${yearSA()}-01-01`, todaySA()],
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The report filter bar every non-Inventory report runs on. `needs` decides
 * which controls appear (the same `needs: string[]` contract StockReport's
 * ReportFilters already used) — a report opts into only what it actually
 * filters by. Tree-shaped needs (cost centre, tag area, account, product)
 * self-fetch their own tree the way CostCenterPickTree/TagAreaPickTree
 * already do; flat needs a caller's own module knows the shape of (status,
 * transaction type, vehicle, driver, route, party) take their choices from
 * the `options` bag instead of a fake shared master this bar would have to
 * invent.
 */
export default function ReportFilterBar({ needs, value, onChange, onRun, busy, options }: {
  needs: Need[];
  value: Filters;
  onChange: (f: Filters) => void;
  onRun: () => void;
  busy?: boolean;
  options?: Partial<Record<Need, MultiOption[]>>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [range, setRange] = useState("Custom");
  const [accountNodes, setAccountNodes] = useState<PickNode[]>([]);
  const [warehouses, setWarehouses] = useState<SearchOption[]>([]);
  const [productNodes, setProductNodes] = useState<QtyNode[]>([]);
  const [itemNodes, setItemNodes] = useState<QtyNode[]>([]);
  const [openPicker, setOpenPicker] = useState<Need | null>(null);

  const has = (n: Need) => needs.includes(n);
  const wantsDates = has("from") || has("to");

  useEffect(() => {
    (async () => {
      if (has("account") || has("accountGroup")) {
        const { data } = await supabase.rpc("acct_tree", { p_company: COMPANY_ID });
        setAccountNodes((data as PickNode[]) ?? []);
      }
      if (has("warehouse")) {
        const { data } = await supabase.from("warehouses").select("id, name").eq("is_active", true).order("name");
        setWarehouses(((data as any[]) ?? []).map((w) => ({ value: w.id, label: w.name })));
      }
      if (has("product") || has("productGroup")) {
        const { data } = await fetchAllRows<any>((from, to) => supabase.from("acct_products")
          .select("id, parent_id, name, is_group").order("id").range(from, to));
        setProductNodes(data as QtyNode[]);
      }
      if (has("items")) {
        const { data } = await supabase.rpc("stock_item_tree");
        setItemNodes((data as QtyNode[]) ?? []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needs.join(",")]);

  const set = (p: Partial<Filters>) => onChange({ ...value, ...p });
  const count = (v: string[] | null) => v?.length ?? 0;
  const opts = (n: Need): MultiOption[] => options?.[n] ?? [];

  return (
    <>
      <div className="card mb-4 flex flex-wrap items-end gap-3">
        {wantsDates && (
          <>
            <div>
              <label className="label">Period</label>
              <select className="input w-36" value={range}
                onChange={(e) => {
                  const k = e.target.value; setRange(k);
                  if (k !== "Custom") { const [f, t] = RANGES[k](); set({ from: f, to: t }); }
                }}>
                {Object.keys(RANGES).map((k) => <option key={k}>{k}</option>)}
              </select>
            </div>
            <div><label className="label">From</label>
              <input type="date" className="input" value={value.from}
                onChange={(e) => { setRange("Custom"); set({ from: e.target.value }); }} /></div>
            <div><label className="label">To</label>
              <input type="date" className="input" value={value.to}
                onChange={(e) => { setRange("Custom"); set({ to: e.target.value }); }} /></div>
          </>
        )}
        {has("asof") && (
          <div><label className="label">As at</label>
            <input type="date" className="input" value={value.asof} onChange={(e) => set({ asof: e.target.value })} /></div>
        )}
        {has("month") && (
          <div><label className="label">Month</label>
            <select className="input w-32" value={value.month} onChange={(e) => set({ month: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></div>
        )}
        {has("year") && (
          <div><label className="label">Year</label>
            <input type="number" className="input w-24 tabular-nums" value={value.year}
              onChange={(e) => set({ year: Number(e.target.value) || yearSA() })} /></div>
        )}
        {has("warehouse") && (
          <div><label className="label">Warehouse</label>
            <SearchSelect value={value.warehouse ?? ""} onChange={(v) => set({ warehouse: v || null })}
              className="w-44" placeholder="All warehouses" options={warehouses} /></div>
        )}
        {(has("costCenter") || has("costCenterName")) && (
          <div><label className="label">Cost Center</label>
            <button onClick={() => setOpenPicker("costCenter")} className="btn-outline h-[38px]">
              {count(value.costCenter) === 0 ? "All cost centers" : `${count(value.costCenter)} selected`}
            </button></div>
        )}
        {(has("tagArea") || has("tagAreaName")) && (
          <div><label className="label">Tag Area</label>
            <button onClick={() => setOpenPicker("tagArea")} className="btn-outline h-[38px]">
              {count(value.tagArea) === 0 ? "All tag areas" : `${count(value.tagArea)} selected`}
            </button></div>
        )}
        {(has("account") || has("accountGroup")) && (
          <div><label className="label">Account</label>
            <button onClick={() => setOpenPicker("account")} className="btn-outline h-[38px]">
              {count(value.account) === 0 ? "All accounts" : `${count(value.account)} selected`}
            </button></div>
        )}
        {(has("product") || has("productGroup")) && (
          <div><label className="label">Product</label>
            <button onClick={() => setOpenPicker("product")} className="btn-outline h-[38px]">
              {count(value.product) === 0 ? "All products" : `${count(value.product)} selected`}
            </button></div>
        )}
        {has("items") && (
          <div><label className="label">Items</label>
            <button onClick={() => setOpenPicker("items")} className="btn-outline h-[38px]">
              {count(value.items) === 0 ? "All items" : `${count(value.items)} selected`}
            </button></div>
        )}
        {has("party") && (
          <div className="w-52"><label className="label">Customer / Supplier</label>
            <MultiSearchSelect value={value.party ?? []} onChange={(v) => set({ party: v.length ? v : null })}
              options={opts("party")} placeholder="Everyone" /></div>
        )}
        {has("vehicle") && (
          <div className="w-44"><label className="label">Vehicle</label>
            <MultiSearchSelect value={value.vehicle ?? []} onChange={(v) => set({ vehicle: v.length ? v : null })}
              options={opts("vehicle")} placeholder="Every vehicle" /></div>
        )}
        {has("driver") && (
          <div className="w-44"><label className="label">Driver</label>
            <MultiSearchSelect value={value.driver ?? []} onChange={(v) => set({ driver: v.length ? v : null })}
              options={opts("driver")} placeholder="Every driver" /></div>
        )}
        {has("route") && (
          <div className="w-44"><label className="label">Route</label>
            <MultiSearchSelect value={value.route ?? []} onChange={(v) => set({ route: v.length ? v : null })}
              options={opts("route")} placeholder="Every route" /></div>
        )}
        {has("status") && (
          <div className="w-44"><label className="label">Status</label>
            <MultiSearchSelect value={value.status ?? []} onChange={(v) => set({ status: v.length ? v : null })}
              options={opts("status")} placeholder="Any status" /></div>
        )}
        {has("txnType") && (
          <div className="w-44"><label className="label">Type</label>
            <MultiSearchSelect value={value.txnType ?? []} onChange={(v) => set({ txnType: v.length ? v : null })}
              options={opts("txnType")} placeholder="Every type" /></div>
        )}
        {has("currency") && (
          <div className="w-32"><label className="label">Currency</label>
            <SearchSelect value={value.currency ?? ""} onChange={(v) => set({ currency: v || null })}
              placeholder="All" options={opts("currency")} /></div>
        )}
        {has("limit") && (
          <div><label className="label">Show top</label>
            <input type="number" min={1} className="input w-24 text-right tabular-nums" value={value.limit}
              onChange={(e) => set({ limit: Math.max(1, Number(e.target.value) || 1) })} /></div>
        )}
        {has("movedOnly") && (
          <label className="flex h-[38px] items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={value.movedOnly} onChange={(e) => set({ movedOnly: e.target.checked })} />
            Moved masters only
          </label>
        )}
        {has("search") && (
          <div className="w-48"><label className="label">Search</label>
            <input className="input" value={value.search} onChange={(e) => set({ search: e.target.value })} placeholder="Search…" /></div>
        )}
        <button onClick={onRun} disabled={busy} className="btn h-[38px]">{busy ? "Running…" : "Run report"}</button>
      </div>

      {openPicker === "costCenter" && (
        <TreeModal title="Select cost centers" onCancel={() => setOpenPicker(null)}>
          <CostCenterPickTree checked={new Set(value.costCenter ?? [])}
            onChange={(s) => set({ costCenter: s.size ? Array.from(s) : null })} />
        </TreeModal>
      )}
      {openPicker === "tagArea" && (
        <TreeModal title="Select tag areas" onCancel={() => setOpenPicker(null)}>
          <TagAreaPickTree checked={new Set(value.tagArea ?? [])}
            onChange={(s) => set({ tagArea: s.size ? Array.from(s) : null })} />
        </TreeModal>
      )}
      {openPicker === "account" && (
        <TreeModal title="Select accounts" onCancel={() => setOpenPicker(null)}>
          <AccountPickTree nodes={accountNodes} checked={new Set(value.account ?? [])}
            onChange={(s) => set({ account: s.size ? Array.from(s) : null })} />
        </TreeModal>
      )}
      {openPicker === "product" && (
        <ItemPickTree title="Select products" nodes={productNodes} selected={value.product}
          showQty={false} onCancel={() => setOpenPicker(null)}
          onOk={(ids) => { set({ product: ids }); setOpenPicker(null); }} />
      )}
      {openPicker === "items" && (
        <ItemPickTree title="Select items" nodes={itemNodes} selected={value.items}
          onCancel={() => setOpenPicker(null)}
          onOk={(ids) => { set({ items: ids }); setOpenPicker(null); }} />
      )}
    </>
  );
}

function TreeModal({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onCancel}>
      <div className="flex h-[70vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button className="btn" onClick={onCancel}>Done</button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
