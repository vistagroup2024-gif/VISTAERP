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
// same fetch the table below renders, so the two can never disagree.
export default function CashBankView() {
  const [groups, setGroups] = useState<DataGroup[] | null>(null);

  const cash = groups ? sumGroup(groups, "cash_driver", "balance") + sumGroup(groups, "cash_other", "balance") : 0;
  const bank = groups ? sumGroup(groups, "bank", "balance") : 0;
  const bankPkr = groups ? sumGroup(groups, "bank_pkr", "balance") : 0;
  const total = cash + bank + bankPkr;
  const debit = groups ? groups.reduce((s, g) => s + Number(g.subtotal?.debit_balance ?? 0), 0) : 0;
  const credit = groups ? groups.reduce((s, g) => s + Number(g.subtotal?.credit_balance ?? 0), 0) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Total Bank" value={money(bank)} />
        <Kpi label="Total PK Bank" value={money(bankPkr)} />
        <Kpi label="Total Cash" value={money(cash)} />
        <Kpi label="Total Cash & Bank" value={money(total)} tone="text-brand-700" />
        <Kpi label="Debit" value={money(debit)} />
        <Kpi label="Credit" value={money(credit)} tone={credit > 0 ? "text-red-600" : undefined} />
        <Kpi label="Net Balance" value={money(total)} />
      </div>
      <ReportRunner registry={ACCOUNTING_REPORTS} report="cash_bank"
        onData={(_rows, g) => setGroups(g ?? [])} />
    </div>
  );
}
