"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import AccountPickTree, { type PickNode } from "@/components/accounting/AccountPickTree";
import CostCenterPickTree from "@/components/reports/pickers/CostCenterPickTree";

const TXN_TYPES = [
  { value: "gl_receipt", label: "Receipt" },
  { value: "gl_payment", label: "Payment" },
  { value: "purchase_voucher", label: "Purchase" },
  { value: "car_sale", label: "Sale" },
  { value: "car_scharge_month", label: "Sale (Service Charge)" },
  { value: "journal", label: "Journal" },
];

// report_transactions() has always accepted p_account_ids/p_cost_centres/
// p_txn_type — the page just never exposed them. URL-driven (like the
// existing From/To fields already were) rather than a client-fetched
// engine, so the KPI row and the table can never show two different
// filtered states: one server render answers both from the same query.
export default function TransactionsFilters({ from, to, account, cc, type }: {
  from: string; to: string; account: string[]; cc: string[]; type: string[];
}) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [acctIds, setAcctIds] = useState<Set<string>>(new Set(account));
  const [ccIds, setCcIds] = useState<Set<string>>(new Set());
  const [ccNames, setCcNames] = useState<Map<string, string>>(new Map());
  const [types, setTypes] = useState<Set<string>>(new Set(type));
  const [accountNodes, setAccountNodes] = useState<PickNode[]>([]);
  const [openPicker, setOpenPicker] = useState<"account" | "cc" | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.rpc("acct_tree", { p_company: COMPANY_ID }).then(({ data }) => setAccountNodes((data as PickNode[]) ?? []));
    sb.from("acct_cost_centers").select("id, name").then(({ data }) => {
      const m = new Map(((data as any[]) ?? []).map((r) => [r.id, r.name as string]));
      setCcNames(m);
      // Pre-select the ids whose names match what's already in the URL.
      if (cc.length) setCcIds(new Set(Array.from(m.entries()).filter(([, name]) => cc.includes(name)).map(([id]) => id)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run() {
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    if (acctIds.size) p.set("account", Array.from(acctIds).join(","));
    if (ccIds.size) p.set("cc", Array.from(ccIds).map((id) => ccNames.get(id)).filter(Boolean).join(","));
    if (types.size) p.set("type", Array.from(types).join(","));
    router.push(`/accounting/transactions?${p.toString()}`);
  }

  return (
    <div className="card mb-4 flex flex-wrap items-end gap-3 print:hidden">
      <div><label className="label">From</label><input type="date" className="input" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <div><label className="label">To</label><input type="date" className="input" value={t} onChange={(e) => setT(e.target.value)} /></div>
      <div><label className="label">Account</label>
        <button onClick={() => setOpenPicker("account")} className="btn-outline h-[38px]">
          {acctIds.size === 0 ? "All accounts" : `${acctIds.size} selected`}
        </button></div>
      <div><label className="label">Cost Centre</label>
        <button onClick={() => setOpenPicker("cc")} className="btn-outline h-[38px]">
          {ccIds.size === 0 ? "All cost centres" : `${ccIds.size} selected`}
        </button></div>
      <div className="w-56"><label className="label">Type</label>
        <div className="flex flex-wrap gap-1">
          {TXN_TYPES.map((tt) => (
            <button key={tt.value} type="button"
              onClick={() => setTypes((s) => { const n = new Set(s); n.has(tt.value) ? n.delete(tt.value) : n.add(tt.value); return n; })}
              className={`rounded-full px-2 py-0.5 text-xs ${types.has(tt.value) ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
              {tt.label}
            </button>
          ))}
        </div>
      </div>
      <button onClick={run} className="btn h-[38px]">Run report</button>

      {openPicker === "account" && (
        <TreeModal title="Select accounts" onCancel={() => setOpenPicker(null)}>
          <AccountPickTree nodes={accountNodes} checked={acctIds} onChange={setAcctIds} />
        </TreeModal>
      )}
      {openPicker === "cc" && (
        <TreeModal title="Select cost centres" onCancel={() => setOpenPicker(null)}>
          <CostCenterPickTree checked={ccIds} onChange={setCcIds} />
        </TreeModal>
      )}
    </div>
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
