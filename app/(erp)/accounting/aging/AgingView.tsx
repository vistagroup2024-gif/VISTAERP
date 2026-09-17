"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
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
  total: number; due: number; overdue: number; total_due: number;
  f0: number; f1: number; f2: number; f3: number; f4: number; ledger_balance: number;
};
type TreeNode = { id: string; code: string; name: string; parent_id: string | null };

// ar_ap_aging()'s ledger_balance is signed so POSITIVE always means "money
// genuinely owed in this row's own direction" — for a supplier that is the
// GL's own CREDIT balance (a normal payable), flipped positive on purpose so
// AR and AP can share one sign convention. Reading that sign directly as
// "Debit" for every row (as this view first shipped) showed a supplier's
// real credit balance as a debit — undoing the flip here, per row, is what
// a genuine Debit/Credit column (real chart-of-accounts sense, the same
// Cash & Bank's own Debit/Credit split already means) needs.
const realSigned = (r: { kind: "customer" | "supplier"; ledger_balance: number }) =>
  r.kind === "supplier" ? -Number(r.ledger_balance) : Number(r.ledger_balance);

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
  const chainOf = (accountId: string) => {
    const chain: TreeNode[] = [];
    let cur = byId.get(accountId);
    while (cur) { chain.push(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
    return chain;
  };
  const resolve = (accountId: string, kind: "customer" | "supplier"): { group: string; isCarCustomer: boolean } => {
    const root = kind === "supplier" ? apRoot : arRoot;
    const chain = chainOf(accountId);
    const isCarCustomer = !!carRoot && chain.some((n) => n.id === carRoot.id);
    const hit = root ? chain.find((n) => n.parent_id === root.id) : undefined;
    return { group: hit?.name ?? chain[1]?.name ?? "Other", isCarCustomer };
  };
  // The old software's third panel: balances that live outside A/C
  // RECEIVABLE / A/C PAYABLE altogether but are still a person/entity owing
  // or being owed — Fixed Assets, Drawing, Long Term Liabilities. Same
  // ancestor-walk, anchored at those three real top-level groups instead.
  const ltRoots = ["1-01", "3-02", "2-11"].map((c) => byCode.get(c)).filter((n): n is TreeNode => !!n);
  const resolveLongTerm = (accountId: string): string | null => {
    const chain = chainOf(accountId);
    const hit = ltRoots.find((root) => chain.some((n) => n.id === root.id));
    return hit?.name ?? null;
  };
  return { resolve, resolveLongTerm };
}

// A/R & A/P Balance — one screen, not two tabs: customer and supplier
// accounts read from the same verified ar_ap_aging() (migration 408/433,
// its ledger_balance already checked against dashboard_metrics().ar_ap),
// called once per kind and combined here rather than switched between. The
// KPI row and the Group -> Account table both total the LEDGER balance, not
// the billed total — an account with a real balance but no open item (an
// opening balance, a receipt saved on account, anything posted with no
// bill raised) still counts, the same trap CLAUDE.md already names for the
// dashboard card.
export default function AgingView() {
  const sb = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [tb, setTb] = useState<any[]>([]);

  const asOf = asOfFromYearMonths(ym);

  useEffect(() => {
    let live = true;
    Promise.all([
      sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: "customer", p_as_of: asOf }),
      sb.rpc("ar_ap_aging", { p_company: COMPANY_ID, p_kind: "supplier", p_as_of: asOf }),
      sb.rpc("acct_tree", { p_company: COMPANY_ID }),
      sb.rpc("trial_balance", { p_company: COMPANY_ID, p_from: null, p_to: asOf }),
    ]).then(([ar, ap, t, trialBal]) => {
      if (!live) return;
      const arRows = ((ar.data as any[]) ?? []).map((r) => ({ ...r, kind: "customer" as const }));
      const apRows = ((ap.data as any[]) ?? []).map((r) => ({ ...r, kind: "supplier" as const }));
      setRows([...arRows, ...apRows]);
      setTree(((t.data as any[]) ?? []).map((n) => ({ id: n.id, code: n.code, name: n.name, parent_id: n.parent_id })));
      setTb((trialBal.data as any[]) ?? []);
    });
    return () => { live = false; };
  }, [sb, asOf]);

  const { resolve, resolveLongTerm } = useMemo(() => buildResolver(tree), [tree]);

  const debitTotal = rows ? rows.reduce((s, r) => s + Math.max(0, realSigned(r)), 0) : null;
  const creditTotal = rows ? rows.reduce((s, r) => s + Math.max(0, -realSigned(r)), 0) : null;
  const balance = debitTotal !== null && creditTotal !== null ? debitTotal - creditTotal : null;
  const show = (n: number | null) => (n === null ? "—" : money(n));

  // Every account with a real balance, split into the main Group -> Account
  // hierarchy and its own separate Vista Car Customers panel.
  const withGroup = (rows ?? []).filter((r) => Math.abs(Number(r.ledger_balance)) > 0.005)
    .map((r) => ({ ...r, ...resolve(r.account_id, r.kind) }));
  const mainRows = withGroup.filter((r) => !r.isCarCustomer);
  const carRows = withGroup.filter((r) => r.isCarCustomer);

  const buildGroups = (list: typeof mainRows): DataGroup[] => {
    const m = new Map<string, typeof mainRows>();
    for (const r of list) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return Array.from(m.entries()).map(([group, grows]) => {
      const debit = grows.reduce((s, r) => s + Math.max(0, realSigned(r)), 0);
      const credit = grows.reduce((s, r) => s + Math.max(0, -realSigned(r)), 0);
      return {
        key: group, label: group,
        meta: <span className="ml-2 font-normal text-slate-500">— debit {money(debit)}, credit {money(credit)}</span>,
        rows: grows.sort((a, b) => Math.abs(realSigned(b)) - Math.abs(realSigned(a))).map((r) => ({
          account_id: r.account_id, name: r.name,
          debit: Math.max(0, realSigned(r)), credit: Math.max(0, -realSigned(r)),
        })),
        subtotal: { debit, credit },
      };
    }).sort((a, b) => (Number(b.subtotal!.debit) + Number(b.subtotal!.credit)) - (Number(a.subtotal!.debit) + Number(a.subtotal!.credit)));
  };
  const mainGroups = buildGroups(mainRows);
  const carGroups = buildGroups(carRows);

  // Long Term panel — Fixed Assets / Drawing / Long Term Liabilities, off
  // trial_balance() (the same verified source Balance Sheet reads), not a
  // second calculation of anything ar_ap_aging() already answers.
  const ltRows = tb.map((r: any) => ({ ...r, group: resolveLongTerm(r.id) })).filter((r) => r.group && Math.abs(Number(r.closing_net)) > 0.005);
  const ltGroups: DataGroup[] = (() => {
    const m = new Map<string, typeof ltRows>();
    for (const r of ltRows) m.set(r.group!, [...(m.get(r.group!) ?? []), r]);
    return Array.from(m.entries()).map(([group, grows]) => {
      const debit = grows.reduce((s, r) => s + Math.max(0, Number(r.closing_net)), 0);
      const credit = grows.reduce((s, r) => s + Math.max(0, -Number(r.closing_net)), 0);
      return {
        key: group, label: group,
        meta: <span className="ml-2 font-normal text-slate-500">— debit {money(debit)}, credit {money(credit)}</span>,
        rows: grows.sort((a, b) => Math.abs(Number(b.closing_net)) - Math.abs(Number(a.closing_net))).map((r) => ({
          account_id: r.id, name: r.name,
          debit: Math.max(0, Number(r.closing_net)), credit: Math.max(0, -Number(r.closing_net)),
        })),
        subtotal: { debit, credit },
      };
    }).sort((a, b) => (Number(b.subtotal!.debit) + Number(b.subtotal!.credit)) - (Number(a.subtotal!.debit) + Number(a.subtotal!.credit)));
  })();

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

          {ltGroups.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Account Receivable / Payable (Long Term)</h2>
              <DataTable cols={groupCols} groups={ltGroups} empty="No long-term balances." />
            </div>
          )}

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Ageing Detail — as at {dateStr(asOf)}</h2>
            <p className="mb-2 text-xs text-slate-400">
              Due is billed, arrived, and its month has not ended; Overdue is billed and its month has ended; Total Due is the two
              added. The 0–30 / 31–60 / … columns are NOT overdue — they are what is not yet due but will come due within that many
              days, so a schedule of installments due next month reads as real numbers here instead of zeros.
            </p>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Due</th>
                    <th className="px-3 py-2 text-right">Overdue</th>
                    <th className="px-3 py-2 text-right">Total Due</th>
                    <th className="px-3 py-2 text-right">Due in 0–30d</th>
                    <th className="px-3 py-2 text-right">31–60d</th>
                    <th className="px-3 py-2 text-right">61–90d</th>
                    <th className="px-3 py-2 text-right">91–180d</th>
                    <th className="px-3 py-2 text-right">180d+</th>
                    <th className="px-3 py-2 text-right">Ledger Balance</th>
                    <th className="sticky right-0 bg-slate-50 px-3 py-2 print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  <AgingRows rows={rows} />
                  {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={12}>Nothing outstanding.</td></tr>}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-3 py-2" colSpan={2}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.due), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.overdue), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.total_due), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.f0), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.f1), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.f2), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.f3), 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + Number(r.f4), 0))}</td>
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
