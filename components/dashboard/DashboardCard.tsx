import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { money } from "@/lib/format";
import type { CardDef, CardKey } from "@/lib/dashboardCards";

const sar = (n: any) => money(Number(n) || 0, "SAR");
const num = (n: any) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n) || 0);

interface Line { label: string; value: string; tone?: string }

// Each card is a headline figure plus the couple of numbers that qualify it.
// The shapes come straight from dashboard_metrics(); a card whose block is
// missing simply reads zero rather than breaking the grid.
function lines(key: CardKey, m: any): { headline: string; sub: Line[]; tone?: string } {
  const d = m?.[key] ?? {};
  switch (key) {
    case "cash_bank":
      return { headline: sar(d.balance), sub: [
        { label: "Cash", value: sar(d.cash) },
        { label: "Bank", value: sar(d.bank) },
      ] };
    case "ar_ap":
      return { headline: sar(d.net), tone: Number(d.net) >= 0 ? "text-green-700" : "text-red-700", sub: [
        { label: "Receivable", value: sar(d.ar), tone: "text-green-700" },
        { label: "Payable", value: sar(d.ap), tone: "text-red-600" },
        { label: "Overdue in", value: sar(d.overdue), tone: Number(d.overdue) > 0 ? "text-amber-600" : undefined },
      ] };
    case "sales":
      return { headline: sar(d.month), sub: [
        { label: "This year", value: sar(d.year) },
        { label: "All time", value: sar(d.total) },
      ] };
    case "expenses":
      return { headline: sar(d.month), tone: "text-red-600", sub: [
        { label: "This year", value: sar(d.year) },
        { label: "All time", value: sar(d.total) },
      ] };
    case "pnl": {
      const m1 = Number(d.income_month || 0) - Number(d.expense_month || 0);
      const y1 = Number(d.income_year || 0) - Number(d.expense_year || 0);
      return { headline: sar(m1), tone: m1 >= 0 ? "text-green-700" : "text-red-700", sub: [
        { label: "Income (month)", value: sar(d.income_month) },
        { label: "Expense (month)", value: sar(d.expense_month) },
        { label: m1 >= 0 ? "Profit (year)" : "Loss (year)", value: sar(Math.abs(y1)), tone: y1 >= 0 ? "text-green-700" : "text-red-700" },
      ] };
    }
    case "car_balances":
      return { headline: sar(d.outstanding), sub: [
        { label: "Overdue", value: sar(d.overdue), tone: Number(d.overdue) > 0 ? "text-red-600" : undefined },
        { label: "Due this month", value: sar(d.due_this_month), tone: "text-amber-700" },
        { label: "Collected", value: sar(d.collected), tone: "text-green-700" },
      ] };
    case "pending_sales_orders":
    case "pending_purchase_orders":
      return { headline: num(d.count), sub: [
        { label: "Value", value: sar(d.value) },
        { label: "Oldest", value: d.oldest ?? "—" },
      ] };
    case "order_status":
      return { headline: num(d.balance), tone: Number(d.balance) < 0 ? "text-red-600" : undefined, sub: [
        { label: "Sale Orders", value: num(d.so_qty) },
        { label: "Stock on hand", value: num(d.stock_qty) },
        { label: "On order (PO)", value: num(d.po_qty) },
      ] };
    case "so_advance_receipt":
      return { headline: sar(d.order_value), sub: [
        { label: "Advance", value: sar(d.advance) },
        { label: "Received", value: sar(d.received), tone: "text-green-700" },
        { label: "Balance", value: sar(d.balance), tone: Number(d.balance) > 0 ? "text-amber-700" : undefined },
      ] };
    case "purchase_vs_sale": {
      const gm = Number(d.sale_month || 0) - Number(d.purchase_month || 0);
      return { headline: sar(gm), tone: gm >= 0 ? "text-green-700" : "text-red-700", sub: [
        { label: "Sold (month)", value: sar(d.sale_month) },
        { label: "Bought (month)", value: sar(d.purchase_month) },
        { label: "Sold (year)", value: sar(d.sale_year) },
      ] };
    }
    case "stock":
      return { headline: sar(d.value), sub: [
        { label: "Quantity", value: num(d.qty) },
        { label: "Items", value: num(d.items) },
      ] };
    case "bookings":
      return { headline: num(d.total), sub: [
        { label: "Pending", value: num(d.pending), tone: Number(d.pending) > 0 ? "text-amber-700" : undefined },
        { label: "Confirmed", value: num(d.confirmed), tone: "text-blue-700" },
        { label: "Check-in today", value: num(d.checkin_today) },
      ] };
    case "delivery_status":
      return { headline: num(d.balance), tone: Number(d.balance) > 0 ? "text-amber-700" : undefined, sub: [
        { label: "Sold", value: num(d.sold) },
        { label: "Delivered", value: num(d.delivered), tone: "text-green-700" },
        { label: "In stock", value: num(d.in_stock) },
      ] };
    // ── absorbed from the module dashboards ────────────────────────────────
    case "approvals":
      return { headline: num(d.pending), tone: Number(d.pending) > 0 ? "text-amber-700" : undefined, sub: [
        { label: "Value waiting", value: sar(d.amount) },
      ] };
    case "pdc":
      return { headline: num(d.pending), sub: [
        { label: "Due within 14 days", value: num(d.due_soon), tone: Number(d.due_soon) > 0 ? "text-amber-700" : undefined },
        { label: "Value", value: sar(d.amount) },
      ] };
    case "car_contracts":
      return { headline: num(d.total), sub: [
        { label: "Active", value: num(d.active), tone: "text-blue-700" },
        { label: "Completed", value: num(d.completed), tone: "text-green-700" },
        { label: "Sale value", value: sar(d.value) },
      ] };
    case "car_service_charges":
      return { headline: sar(d.this_month), sub: [
        { label: "Outstanding", value: sar(d.outstanding) },
        { label: "Overdue", value: sar(d.overdue), tone: Number(d.overdue) > 0 ? "text-red-600" : undefined },
      ] };
    case "car_ownership":
      return { headline: num(d.total), sub: [
        { label: "Transferred", value: num(d.transferred) },
        { label: "Vista-owned", value: num(d.vista) },
        { label: "Held", value: num(d.held), tone: Number(d.held) > 0 ? "text-red-600" : undefined },
      ] };
    case "hotel_financials":
      return { headline: sar(d.profit), tone: Number(d.profit) >= 0 ? "text-green-700" : "text-red-700", sub: [
        { label: "Sales", value: sar(d.sales) },
        { label: "Purchase", value: sar(d.purchase) },
        { label: "HCN pending", value: num(d.hcn_pending), tone: Number(d.hcn_pending) > 0 ? "text-red-600" : undefined },
      ] };
    case "brn_beds":
      return { headline: `${num(d.occupancy)}%`, tone: Number(d.occupancy) > 90 ? "text-red-600" : undefined, sub: [
        { label: "Beds bought", value: num(d.purchased) },
        { label: "Beds reserved", value: num(d.reserved), tone: "text-brand" },
      ] };
    case "brn_availability":
      return { headline: num(Number(d.makkah || 0) + Number(d.madinah || 0)), tone: "text-green-700", sub: [
        { label: "Makkah tonight", value: num(d.makkah) },
        { label: "Madinah tonight", value: num(d.madinah) },
        { label: "Check-in / out today", value: `${num(d.checkin_today)} / ${num(d.checkout_today)}` },
      ] };
    case "brn_agreements":
      return { headline: num(d.active), sub: [
        { label: "Expiring ≤ 7 days", value: num(d.expiring), tone: Number(d.expiring) > 0 ? "text-amber-700" : undefined },
        { label: "All BRNs", value: num(d.total) },
        { label: "Supplier outstanding", value: sar(d.supplier_outstanding), tone: Number(d.supplier_outstanding) > 0 ? "text-red-600" : undefined },
      ] };
    case "transport":
      return { headline: sar(d.revenue), sub: [
        { label: "Bookings pending", value: num(d.pending), tone: Number(d.pending) > 0 ? "text-amber-700" : undefined },
        { label: "Trips running", value: num(d.in_progress), tone: "text-blue-700" },
        { label: "No driver yet", value: num(d.unassigned), tone: Number(d.unassigned) > 0 ? "text-red-600" : undefined },
      ] };
    case "visa_groups":
      return { headline: num(d.total), sub: [
        { label: "In process", value: num(d.process), tone: "text-blue-700" },
        { label: "Visa issued", value: num(d.issued), tone: "text-green-700" },
        { label: "Waiting BRN", value: num(d.waiting_brn), tone: Number(d.waiting_brn) > 0 ? "text-amber-700" : undefined },
      ] };

    default:
      return { headline: "—", sub: [] };
  }
}

export default function DashboardCard({ def, metrics }: { def: CardDef; metrics: any }) {
  const { headline, sub, tone } = lines(def.key, metrics);
  const body = (
    <div className="card h-full transition-shadow hover:shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{def.label}</p>
        {def.href && <Icon name="chevronRight" size={14} className="shrink-0 text-slate-300" />}
      </div>
      <p className={`mt-1.5 truncate text-2xl font-bold tabular-nums ${tone ?? "text-slate-900"}`}>{headline}</p>
      {sub.length > 0 && (
        <dl className="mt-3 space-y-1 border-t border-slate-100 pt-2">
          {sub.map((s) => (
            <div key={s.label} className="flex items-baseline justify-between gap-2 text-xs">
              <dt className="truncate text-slate-500">{s.label}</dt>
              <dd className={`shrink-0 font-medium tabular-nums ${s.tone ?? "text-slate-700"}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
  return def.href ? <Link href={def.href} className="block">{body}</Link> : body;
}
