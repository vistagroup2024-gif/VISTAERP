"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import DonutChart from "@/components/reports/charts/DonutChart";
import AgingRows from "./AgingRows";
import { defaultYearMonths, asOfFromYearMonths, type YearMonths } from "@/lib/reports/period";

const money = (n: number) => n ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";

type Row = {
  account_id: string; name: string; phone: string | null; kind: "customer" | "supplier";
  total: number; not_due: number; b0: number; b1: number; b2: number; b3: number; b4: number; ledger_balance: number;
};
type TreeNode = { id: string; code: string; name: string; parent_id: string | null };

// Resolves each account to the same chart-of-accounts group the old
// software's report rolled it up under (CUSTOMERS, OTHERS RECEIVABLE,
// SUPPLIERS, …) — the real ancestor one level below A/C RECEIVABLE (1-04)
// or A/C PAYABLE (2-01) in THIS company's own tree, read from acct_tree(),
// never invented or hand-listed. Also flags VISTA CAR CUSTOMERS specifically
// (anywhere in the ancestor chain) so it can be pulled into its own panel.
function buildResolver(tree: TreeNode[]) {
  const byId = new Map(tree.map((n) => [n.id, n]));
  const byCode = new Map(tree.map((n) => [n.code, n]));
  const arRoot = byCode.get("1-04");
  const apRoot = byCode.get("2-01");
  const carRoot = byCode.get("1-04-01-04");
  return (accountId: string, kind: "customer" | "supplier"): { group: string; isCarCustomer: boolean } => {
    const root = kind === "supplier" ? apRoot : arRoot;
    const chain: TreeNode[] = [];
    let cur = byId.get(accountId);
    while (cur) { chain.push(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    const isCarCustomer = !!carRoot && chain.some((n) => n.id === carRoot.id);
    const hit = root ? chain.find((n) => n.parent_id === root.id) : undefined;
    return { group: hit?.name ?? chain[1]?.name ?? "Other", isCarCustomer };
  };
}

// A/R & A/P Balance — one screen, not two tabs: customer and supplier
// accounts read from the same verified ar_ap_aging() (migration 408, its
// ledger_balance already checked against dashboard_metrics().ar_ap), called
// once per kind and combined here rather than switched between. The KPI row
// and the Group -> Account table both total the LEDGER balance, not the
// billed total — an account with a real balance but no open item (an
// opening balance, a receipt saved on account, anything posted with no
// bill raised) still counts, the same trap CLAUDE.md already names for the
// dashboard card. The detailed ageing table below keeps the billed
// total/bucket columns for what IS billed and when it's due.
export default function AgingView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);

  const asOf = asOfFromYearMonths(ym);

  useEffect(() => {
    let live = true;
    Promise.all([
      sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: "customer", p_as_of: asOf }),
      sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: "supplier", p_as_of: asOf }),
      sb.rpc("acct_tree", { p_company: COMPANY_ID }),
    ]).then(([ar, ap, t]) => {
      if (!live) return;
      const arRows = ((ar.data as any[]) ?? []).map((r) => ({ ...r, kind: "customer" as const }));
      const apRows = ((ap.data as any[]) ?? []).map((r) => ({ ...r, kind: "supplier" as const }));
      setRows([...arRows, ...apRows]);
      setTree(((t.data as any[]) ?? []).map((n) => ({ id: n.id, code: n.code, name: n.name, parent_id: n.parent_id })));
    });
    return () => { live = false; };
  }, [sb, asOf]);

  const resolve = useMemo(() => buildResolver(tree), [tree]);

  const debitTotal = rows ? rows.reduce((s, r) => s + Math.max(0, Number(r.ledger_balance)), 0) : null;
  const creditTotal = rows ? rows.reduce((s, r) => s + Math.max(0, -Number(r.ledger_balance)), 0) : null;
  const balance = debitTotal !== null && creditTotal !== null ? debitTotal - creditTotal : null;
  const show = (n: number | null) => (n === null ? "—" : money(n));

  // Every account with a real balance, split into the main Group -> Account
  // hierarchy and its own separate Vista Car Customers panel.
  const withGroup = (rows ?? []).filter((r) => Math.abs(Number(r.ledger_balance)) > 0.005)
    .map((r) => ({ ...r, ...resolve(r.account_id, r.kind) }));
  const mainRows = withGroup.filter((r) => !r.isCarCustomer);
  const carRows = withGroup.filter((r) => r.isCarCustomer);

  const groupMap = new Map<string, typeof mainRows>();
  for (const r of mainRows) groupMap.set(r.group, [...(groupMap.get(r.group) ?? []), r]);
  const buildGroups = (list: typeof mainRows): DataGroup[] => {
    const m = new Map<string, typeof mainRows>();
    for (const r of list) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return Array.from(m.entries()).map(([group, grows]) => {
      const debit = grows.reduce((s, r) => s + Math.max(0, Number(r.ledger_balance)), 0);
      const credit = grows.reduce((s, r) => s + Math.max(0, -Number(r.ledger_balance)), 0);
      return {
        key: group, label: group,
        meta: <span className="ml-2 font-normal text-slate-500">— debit {money(debit)}, credit {money(credit)}</span>,
        rows: grows.sort((a, b) => Math.abs(Number(b.ledger_balance)) - Math.abs(Number(a.ledger_balance))).map((r) => ({
          account_id: r.account_id, name: r.name,
          debit: Math.max(0, Number(r.ledger_balance)), credit: Math.max(0, -Number(r.ledger_balance)),
        })),
        subtotal: { debit, credit },
      };
    }).sort((a, b) => (Number(b.subtotal!.debit) + Number(b.subtotal!.credit)) - (Number(a.subtotal!.debit) + Number(a.subtotal!.credit)));
  };
  const mainGroups = buildGroups(mainRows);
  const carGroups = buildGroups(carRows);

  const groupCols = [
    { key: "name", label: "Account", href: (r: any) => r.account_id ? `/accounting/customers/${r.account_id}` : null },
    { key: "debit", label: "Debit Balance", kind: "money" as const, total: true },
    { key: "credit", label: "Credit Balance", kind: "money" as const, total: true },
  ];

  const chartData = mainGroups.map((g) => ({ name: g.label, value: Number(g.subtotal!.debit) + Number(g.subtotal!.credit) }))
    .concat(carGroups.length ? [{ name: "Vista Car Customers", value: carRows.reduce((s, r) => s + Math.abs(Number(r.ledger_balance)), 0) }] : []);

  return (
    <div className="space-y-4">
      <PageHeader title="A/R & A/P Balance" subtitle="Every receivable and payable account with a real ledger balance, grouped the same way the chart of accounts groups them.">
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-3 gap-3">
        <ReportKpi label="Debit" value={show(debitTotal)} icon="trendUp" tone="pos" />
        <ReportKpi label="Credit" value={show(creditTotal)} icon="trendDown" tone="neg" />
        <ReportKpi label="Balance" value={balance === null ? "—" : `${money(Math.abs(balance))} ${balance >= 0 ? "DR" : "CR"}`} icon="wallet" tone={balance !== null && balance < 0 ? "neg" : "info"} />
      </div>

      {rows === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Account Receivable and Payable</h2>
              <DataTable cols={groupCols} groups={mainGroups} empty="Nothing outstanding." />
            </div>
            <div className="card">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">By Group</h2>
              <DonutChart data={chartData} nameKey="name" valueKey="value" height={260} />
            </div>
          </div>

          {carGroups.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Account Receivables — Vista Car Customers</h2>
              <DataTable cols={groupCols} groups={carGroups} empty="No car customer balances." />
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Ageing Detail — as at {asOf}</h2>
            <p className="mb-2 text-xs text-slate-400">Aged by due date. Not due is what has been billed but is not yet due — an instalment for next month, a bill inside its credit days.</p>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Billed Total</th>
                    <th className="px-3 py-2 text-right">Not due</th>
                    <th className="px-3 py-2 text-right">0–30</th>
                    <th className="px-3 py-2 text-right">31–60</th>
                    <th className="px-3 py-2 text-right">61–90</th>
                    <th className="px-3 py-2 text-right">91–180</th>
                    <th className="px-3 py-2 text-right">180+</th>
                    <th className="px-3 py-2 text-right">Ledger Balance</th>
                    <th className="sticky right-0 bg-slate-50 px-3 py-2 print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  <AgingRows rows={rows} />
                  {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={11}>Nothing outstanding.</td></tr>}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-3 py-2" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.total), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">{money(rows.reduce((s, r) => s + Number(r.not_due), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.b0), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.b1), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.b2), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.b3), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.b4), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.ledger_balance), 0))}</td>
                      <td className="sticky right-0 bg-slate-50 print:hidden" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
