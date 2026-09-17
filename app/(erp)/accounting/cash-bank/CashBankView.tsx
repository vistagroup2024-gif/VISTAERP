"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { ACCOUNTING_REPORTS } from "@/lib/reports/accounting";
import ReportFilterBar, { defaultReportFilters, type Filters } from "@/components/reports/ReportFilters";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import DonutChart from "@/components/reports/charts/DonutChart";
import { downloadCsv } from "@/lib/reports/export";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const CFG = ACCOUNTING_REPORTS.cash_bank;

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone ?? "text-slate-800"}`}>{value}</p>
    </div>
  );
}

const sumGroup = (groups: DataGroup[], key: string, field: string) =>
  groups.find((g) => g.key === key)?.subtotal?.[field] ?? 0;

// Cash & Bank — a custom layout on top of the same report_cash_bank() RPC
// (422) the dashboard's own Cash & Bank card reads, styled after the old
// software's report: four balance cards, a collapsible Group -> Account
// table, and a donut showing each account's own share — instead of the
// generic ReportRunner table (which had a redundant Net Balance column
// duplicating whichever of Debit/Credit was filled, and a Share column
// repeating that same split per row now shown once, as the chart).
//
// A zero-balance account (opened, never moved, or since cleared) is dropped
// from both the table and the chart — dropping it is presentation only,
// group subtotals are still the RPC's own sums and unaffected by it.
export default function CashBankView() {
  const supabase = useMemo(() => createClient(), []);
  const [filters, setFilters] = useState<Filters>(defaultReportFilters);
  const [groups, setGroups] = useState<DataGroup[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    const { data } = await supabase.rpc("report_cash_bank", {
      p_company: COMPANY_ID, p_as_of: filters.asof,
      p_account_ids: filters.account, p_cost_center_ids: filters.costCenter,
    });
    setBusy(false);
    const raw = ((data as DataGroup[]) ?? []).map((g) => ({
      ...g, rows: g.rows.filter((r: any) => Math.abs(r.debit_balance) > 0.005 || Math.abs(r.credit_balance) > 0.005),
    })).filter((g) => g.rows.length > 0);
    setGroups(raw);
  }, [supabase, filters.asof, filters.account, filters.costCenter]);

  useEffect(() => { run(); }, [filters.asof, filters.account, filters.costCenter]); // eslint-disable-line react-hooks/exhaustive-deps

  const cash = groups ? sumGroup(groups, "cash_driver", "balance") + sumGroup(groups, "cash_other", "balance") : null;
  const bank = groups ? sumGroup(groups, "bank", "balance") : null;
  const bankPkr = groups ? sumGroup(groups, "bank_pkr", "balance") : null;
  const total = groups ? (cash ?? 0) + (bank ?? 0) + (bankPkr ?? 0) : null;
  const show = (n: number | null) => (n === null ? "—" : money(n));

  const chartData = (groups ?? []).flatMap((g) => g.rows).map((r: any) => ({ name: r.name, value: Math.abs(Number(r.balance) || 0) }));
  const exportRows = (groups ?? []).flatMap((g) => g.rows);

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <ReportFilterBar needs={["asof", "account", "costCenter"]} value={filters} onChange={setFilters} onRun={run} busy={busy} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Bank" value={show(bank)} />
        <Kpi label="PK Bank" value={show(bankPkr)} />
        <Kpi label="Cash" value={show(cash)} />
        <Kpi label="Total Cash & Bank" value={show(total)} tone="text-brand-700" />
      </div>

      {groups === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
          <div>
            <div className="mb-2 flex justify-end gap-2 print:hidden">
              <button className="btn-outline" onClick={() => downloadCsv(CFG.key, CFG.cols, exportRows)}>Excel (CSV)</button>
            </div>
            <DataTable cols={CFG.cols} groups={groups} empty="No cash or bank accounts with a balance." />
          </div>
          <div className="card">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Share of Total</h2>
            <DonutChart data={chartData} nameKey="name" valueKey="value" height={280} />
          </div>
        </div>
      )}
    </div>
  );
}
