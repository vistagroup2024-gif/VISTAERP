import ExpenseReportView from "./ExpenseReportView";

export const dynamic = "force-dynamic";

// Expenses — see ExpenseReportView for the RPCs and the reasoning; the
// header (title, PeriodDropdown, Print) is drawn there, in the same row as
// the title, since it needs the view's own client state.
export default function ExpensesPage() {
  return <ExpenseReportView />;
}
