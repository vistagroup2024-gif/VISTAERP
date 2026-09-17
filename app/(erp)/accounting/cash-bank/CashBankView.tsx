"use client";

import { useState } from "react";
import ReportRunner from "@/components/reports/ReportRunner";
import { ACCOUNTING_REPORTS } from "@/lib/reports/accounting";
import type { DataGroup } from "@/components/reports/DataTable";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

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

// Cash & Bank's own KPI row — fed by ReportRunner's onData, off the exact
// same fetch the table below renders, so the two can never disagree. groups
// stays null (never []) until a REAL response lands: ReportRunner reports
// once on mount with rows still null (nothing fetched yet), and reading that
// as "zero" is what put a confident 0.00 on every KPI before the report had
// actually run — a report that hasn't loaded yet is not the same thing as
// one that loaded and found nothing.
export default function CashBankView() {
  const [groups, setGroups] = useState<DataGroup[] | null>(null);

  const cash = groups ? sumGroup(groups, "cash_driver", "balance") + sumGroup(groups, "cash_other", "balance") : null;
  const bank = groups ? sumGroup(groups, "bank", "balance") : null;
  const bankPkr = groups ? sumGroup(groups, "bank_pkr", "balance") : null;
  const total = groups ? (cash ?? 0) + (bank ?? 0) + (bankPkr ?? 0) : null;
  const debit = groups ? groups.reduce((s, g) => s + Number(g.subtotal?.debit_balance ?? 0), 0) : null;
  const credit = groups ? groups.reduce((s, g) => s + Number(g.subtotal?.credit_balance ?? 0), 0) : null;
  const show = (n: number | null) => (n === null ? "—" : money(n));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Total Bank" value={show(bank)} />
        <Kpi label="Total PK Bank" value={show(bankPkr)} />
        <Kpi label="Total Cash" value={show(cash)} />
        <Kpi label="Total Cash & Bank" value={show(total)} tone="text-brand-700" />
        <Kpi label="Debit" value={show(debit)} />
        <Kpi label="Credit" value={show(credit)} tone={credit && credit > 0 ? "text-red-600" : undefined} />
        <Kpi label="Net Balance" value={show(total)} />
      </div>
      <ReportRunner registry={ACCOUNTING_REPORTS} report="cash_bank"
        onData={(rows, g) => { if (rows !== null) setGroups(g ?? []); }} />
    </div>
  );
}
