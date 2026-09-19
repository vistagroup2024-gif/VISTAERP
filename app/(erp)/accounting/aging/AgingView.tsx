"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, dateStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import DonutChart from "@/components/reports/charts/DonutChart";
import AgingRows from "./AgingRows";
import { defaultYearMonths, asOfFromYearMonths, type YearMonths } from "@/lib/reports/period";

const money = (n: number) => n ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) : "";
// money() blanks a zero on purpose for a Debit/Credit table cell (the other
// side already carries the figure) — a KPI tile has no "other side", so a
// real zero needs to read as 0.00, not go blank as if nothing loaded.
const kpiMoney = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

// The at-a-glance pair — every account with a real balance, split by
// direction only (no group, no ageing), so "who do I owe, who owes me" is
// answered by the first grid on the page, before the detailed ones below.
function QuickList({ title, rows }: { title: string; rows: { account_id: string; name: string; kind: "customer" | "supplier"; amount: number }[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div>
      <SectionHeader title={title} />
      <div className="card min-h-[420px] max-h-[640px] overflow-y-auto overflow-x-auto p-0">
        <table className="report-grid w-full text-sm">
          <thead className="sticky top-0 bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
            <tr>
              <th className="px-3 py-2.5 text-left"><span className="col-resize">Name</span></th>
              <th className="px-3 py-2.5 text-left"><span className="col-resize">Type</span></th>
              <th className="px-3 py-2.5 text-right"><span className="col-resize">Amount</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.account_id} className={i % 2 === 1 ? "bg-slate-50/70" : ""}>
                <td className="px-3 py-2"><Link href={`/accounting/customers/${r.account_id}`} className="hover:text-brand hover:underline">{r.name}</Link></td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.kind === "customer" ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-700"}`}>
                    {r.kind === "customer" ? "Customer" : "Supplier"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{money(r.amount)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-4 text-center text-slate-400" colSpan={3}>None.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="sticky bottom-0 bg-slate-50 font-semibold">
              <td className="px-3 py-2" colSpan={2}>Total ({rows.length})</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(total)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

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
  const show = (n: number | null) => (n === null ? "—" : kpiMoney(n));

  // Every account with a real balance, split into the main Group -> Account
  // hierarchy and its own separate Vista Car Customers panel.
  const withGroup = (rows ?? []).filter((r) => Math.abs(Number(r.ledger_balance)) > 0.005)
    .map((r) => ({ ...r, ...resolve(r.account_id, r.kind) }));
  const mainRows = withGroup.filter((r) => !r.isCarCustomer);
  const carRows = withGroup.filter((r) => r.isCarCustomer);

  // Quick-glance Receivable / Payable — every account with a balance
  // (car customers included), split purely by direction via the same
  // realSigned() sign the Debit/Credit columns already use.
  const receivableRows = withGroup.filter((r) => realSigned(r) > 0)
    .sort((a, b) => realSigned(b) - realSigned(a))
    .map((r) => ({ account_id: r.account_id, name: r.name, kind: r.kind, amount: realSigned(r) }));
  const payableRows = withGroup.filter((r) => realSigned(r) < 0)
    .sort((a, b) => realSigned(a) - realSigned(b))
    .map((r) => ({ account_id: r.account_id, name: r.name, kind: r.kind, amount: -realSigned(r) }));

  const buildGroups = (list: typeof mainRows): DataGroup[] => {
    const m = new Map<string, typeof mainRows>();
    for (const r of list) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return Array.from(m.entries()).map(([group, grows]) => {
      const debit = grows.reduce((s, r) => s + Math.max(0, realSigned(r)), 0);
      const credit = grows.reduce((s, r) => s + Math.max(0, -realSigned(r)), 0);
      return {
        key: group, label: group,
        rows: grows.sort((a, b) => Math.abs(realSigned(b)) - Math.abs(realSigned(a))).map((r) => ({
          account_id: r.account_id, name: r.name,
          debit: Math.max(0, realSigned(r)), credit: Math.max(0, -realSigned(r)),
        })),
        // `values` puts the group's own Debit/Credit on its header row —
        // without it a collapsed group (the default) shows only its label,
        // no balance anywhere, the same blank-header bug Cash & Bank had.
        subtotal: { debit, credit }, values: { debit, credit },
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
        rows: grows.sort((a, b) => Math.abs(Number(b.closing_net)) - Math.abs(Number(a.closing_net))).map((r) => ({
          account_id: r.id, name: r.name,
          debit: Math.max(0, Number(r.closing_net)), credit: Math.max(0, -Number(r.closing_net)),
        })),
        subtotal: { debit, credit }, values: { debit, credit },
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

  const carTotal = carRows.reduce((s, r) => s + Math.abs(Number(r.ledger_balance)), 0);
  const ltChartData = ltGroups.map((g) => ({ name: g.label, value: Number(g.subtotal!.debit) + Number(g.subtotal!.credit) }));

  // Ageing Detail split by real direction (the same realSigned() sign the
  // Receivable/Payable QuickLists already use above) rather than one mixed
  // grid a reader has to work out for themselves row by row — a Payable row
  // in this grid is genuinely payable, not just a "supplier" that happens to
  // carry a receivable balance today (or the reverse for a customer in credit).
  const receivableDetailRows = (rows ?? []).filter((r) => realSigned(r) > 0.005);
  const payableDetailRows = (rows ?? []).filter((r) => realSigned(r) < -0.005);

  return (
    <div className="space-y-4">
      <PageHeader title="A/R & A/P Balance">
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
          <div className="grid gap-4 lg:grid-cols-2">
            <QuickList title="Receivable — Who Owes Us" rows={receivableRows} />
            <QuickList title="Payable — Who We Owe" rows={payableRows} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
            <div>
              <SectionHeader title="Account Receivable and Payable" />
              <DataTable cols={groupCols} groups={mainGroups} empty="Nothing outstanding." />
            </div>
            <div className="card">
              <SectionHeader title="By Group" />
              <DonutChart data={chartData} nameKey="name" valueKey="value" height={260} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
            <div>
              <SectionHeader title="Account Receivables — Vista Car Customers" />
              <DataTable cols={groupCols} groups={carGroups} empty="No car customer balances." />
            </div>
            <div className="card">
              <SectionHeader title="Car Customers Summary" />
              <div className="grid grid-cols-2 gap-3">
                <ReportKpi label="Customers" value={String(carRows.length)} icon="users" />
                <ReportKpi label="Balance" value={kpiMoney(carTotal)} icon="wallet" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
            <div>
              <SectionHeader title="Account Receivable / Payable (Long Term)" />
              <DataTable cols={groupCols} groups={ltGroups} empty="No long-term balances." />
            </div>
            <div className="card">
              <SectionHeader title="By Category" />
              <DonutChart data={ltChartData} nameKey="name" valueKey="value" height={260} />
            </div>
          </div>

          <AgingDetailGrid title={`Ageing Detail — Receivable — as at ${dateStr(asOf)}`} rows={receivableDetailRows} />
          <AgingDetailGrid title={`Ageing Detail — Payable — as at ${dateStr(asOf)}`} rows={payableDetailRows} />
        </>
      )}
    </div>
  );
}

// Same 11-column shape the combined grid used, just scoped to one direction
// (Receivable or Payable) so a reader never has to work out which a row is —
// the grid it's in already says so.
function AgingDetailGrid({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div>
      <SectionHeader title={title} />
      <div className="card overflow-x-auto p-0">
        <table className="report-grid w-full text-sm">
          <thead className="bg-brand-50 text-[11px] font-semibold uppercase tracking-wide text-brand-800">
            <tr>
              <th className="px-3 py-2 text-left"><span className="col-resize">Name</span></th>
              <th className="px-3 py-2 text-left"><span className="col-resize">Type</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Due</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Overdue</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Total Due</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Due in 0–30d</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">31–60d</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">61–90d</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">91–180d</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">180d+</span></th>
              <th className="px-3 py-2 text-right"><span className="col-resize">Ledger Balance</span></th>
            </tr>
          </thead>
          <tbody>
            <AgingRows rows={rows} />
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={11}>Nothing outstanding.</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
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
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
