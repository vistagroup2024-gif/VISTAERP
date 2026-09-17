"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";
import { ACCOUNTING_REPORTS } from "@/lib/reports/accounting";
import PageHeader from "@/components/PageHeader";
import PrintButton from "@/components/PrintButton";
import DataTable, { type DataGroup } from "@/components/reports/DataTable";
import DonutChart from "@/components/reports/charts/DonutChart";
import TrendChart from "@/components/reports/charts/TrendChart";
import ReportKpi from "@/components/reports/ReportKpi";
import SectionHeader from "@/components/reports/SectionHeader";
import PeriodDropdown from "@/components/reports/PeriodDropdown";
import { defaultYearMonths, asOfFromYearMonths, type YearMonths } from "@/lib/reports/period";
import { downloadCsv } from "@/lib/reports/export";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const CFG = ACCOUNTING_REPORTS.cash_bank;

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
// No filter box at all: not the old "As at" date, and not Account/Cost
// Centre/Run report either — this report always shows every cash and bank
// account, so there was nothing for those two to actually narrow. The
// PeriodDropdown, in the title row, is the one control this report needs:
// an as-at report reads it as a single date via asOfFromYearMonths() (the
// last day of the latest month picked, capped at today).
//
// A zero-balance account (opened, never moved, or since cleared) is dropped
// from both the table and the chart — dropping it is presentation only,
// group subtotals are still the RPC's own sums and unaffected by it.
export default function CashBankView() {
  const supabase = useMemo(() => createClient(), []);
  const [ym, setYm] = useState<YearMonths>(defaultYearMonths);
  const [groups, setGroups] = useState<DataGroup[] | null>(null);

  const asOf = asOfFromYearMonths(ym);

  const run = useCallback(async () => {
    const { data } = await supabase.rpc("report_cash_bank", { p_company: COMPANY_ID, p_as_of: asOf });
    const raw = ((data as DataGroup[]) ?? []).map((g) => ({
      ...g, rows: g.rows.filter((r: any) => Math.abs(r.debit_balance) > 0.005 || Math.abs(r.credit_balance) > 0.005),
    })).filter((g) => g.rows.length > 0);
    setGroups(raw);
  }, [supabase, asOf]);

  useEffect(() => { run(); }, [run]);

  const cash = groups ? sumGroup(groups, "cash_driver", "balance") + sumGroup(groups, "cash_other", "balance") : null;
  const bank = groups ? sumGroup(groups, "bank", "balance") : null;
  const bankPkr = groups ? sumGroup(groups, "bank_pkr", "balance") : null;
  const total = groups ? (cash ?? 0) + (bank ?? 0) + (bankPkr ?? 0) : null;
  const show = (n: number | null) => (n === null ? "—" : money(n));

  const byType = [
    { type: "Bank", amount: bank ?? 0 },
    { type: "PK Bank", amount: bankPkr ?? 0 },
    { type: "Cash", amount: cash ?? 0 },
  ];
  const chartData = (groups ?? []).flatMap((g) => g.rows).map((r: any) => ({ name: r.name, value: Math.abs(Number(r.balance) || 0) }));
  const exportRows = (groups ?? []).flatMap((g) => g.rows);

  return (
    <div className="space-y-4">
      <PageHeader title={CFG.title} subtitle={CFG.subtitle}>
        <PeriodDropdown value={ym} onChange={setYm} />
        <PrintButton />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ReportKpi label="Bank" value={show(bank)} icon="accounting" />
        <ReportKpi label="PK Bank" value={show(bankPkr)} icon="accounting" />
        <ReportKpi label="Cash" value={show(cash)} icon="wallet" />
        <ReportKpi label="Total Cash & Bank" value={show(total)} icon="receipt" tone={total !== null && total < 0 ? "neg" : "info"} />
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
          <div className="space-y-4">
            <div className="card">
              <SectionHeader title="Balance by Type" />
              <TrendChart data={byType} xKey="type" series={[{ key: "amount", label: "Balance" }]} height={160} />
            </div>
            <div className="card">
              <SectionHeader title="Share of Total" />
              <DonutChart data={chartData} nameKey="name" valueKey="value" height={240} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
