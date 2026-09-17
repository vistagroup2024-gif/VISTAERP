// Accounting reports registry — thin ReportCfg entries over existing RPCs,
// the same config-only convention lib/stockReports.ts already established.
import { COMPANY_ID } from "@/lib/format";
import type { ReportCfg } from "./types";

export const ACCOUNTING_REPORTS: Record<string, ReportCfg> = {
  cash_bank: {
    key: "cash_bank", title: "Cash & Bank",
    subtitle: "Balance of every cash and bank account, as at a date. Grouped the same way the chart of accounts groups them.",
    rpc: "report_cash_bank",
    params: ["asof", "account", "costCenter"],
    fixedArgs: { p_company: COMPANY_ID },
    shape: "grouped",
    // No Net Balance or Share of Total column: an account only ever carries
    // one of Debit/Credit (never both), so Net Balance would just repeat
    // whichever of the two is already filled in, and Share is answered by
    // the donut chart beside the table (CashBankView) rather than a number
    // repeated on every row.
    cols: [
      { key: "code", label: "Code", hideByDefault: true },
      { key: "name", label: "Account", href: (row) => row.account_id ? `/accounting/ledger?account=${row.account_id}` : null },
      { key: "debit_balance", label: "Debit Balance", kind: "money", total: true },
      { key: "credit_balance", label: "Credit Balance", kind: "money", total: true },
    ],
    empty: "No cash or bank accounts.",
  },
};
