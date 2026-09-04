import Link from "next/link";
import { money, dateStr } from "@/lib/format";
import type { CardDef, CardKey } from "@/lib/dashboardCards";

type Tone = "pos" | "neg" | "warn" | "info" | undefined;

const TONE: Record<string, string> = {
  pos: "text-emerald-600",
  neg: "text-red-600",
  warn: "text-amber-600",
  info: "text-brand",
};

// Big numbers are read at a glance, so they are shortened — 1.1M, 136K — with
// the exact figure kept on the element's title for when it matters.
function compact(n: number): string {
  const a = Math.abs(n);
  // 999,600 rounds to 1000K, which reads as ten times what it is — so anything
  // that would round up to a million is shown in millions.
  if (a >= 999_500) return (n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 10_000) return Math.round(n / 1000) + "K";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: a < 100 ? 2 : 0 }).format(n);
}

const N = (v: any) => Number(v) || 0;
const cash = (v: any): Cell["value"] => ({ text: compact(N(v)), title: money(N(v), "SAR") });
const qty = (v: any): Cell["value"] => ({ text: compact(N(v)), title: new Intl.NumberFormat().format(N(v)) });
const raw = (t: string): Cell["value"] => ({ text: t });

interface Cell { label: string; value: { text: string; title?: string }; tone?: Tone; strong?: boolean }

// Each card is a row of cells: a small label over a big figure. Cells share the
// row and wrap when the card is narrow, so a four-figure card stays readable on
// a phone without a separate layout.
function cells(key: CardKey, m: any): Cell[] {
  const d = m?.[key] ?? {};
  const sign = (n: number): Tone => (n < 0 ? "neg" : undefined);
  switch (key) {
    case "cash_bank": return [
      { label: "Bank", value: cash(d.bank) },
      { label: "Cash", value: cash(d.cash) },
      { label: "Total", value: cash(d.balance), strong: true, tone: sign(N(d.balance)) },
    ];
    case "ar_ap": return [
      { label: "Receivable", value: cash(d.ar), tone: "pos" },
      { label: "Payable", value: cash(d.ap), tone: "neg" },
      { label: "Overdue", value: cash(d.overdue), tone: N(d.overdue) > 0 ? "warn" : undefined },
      { label: "Net", value: cash(d.net), strong: true, tone: N(d.net) >= 0 ? "pos" : "neg" },
    ];
    case "sales": return [
      { label: "This month", value: cash(d.month), strong: true },
      { label: "Year to date", value: cash(d.year) },
      { label: "All time", value: cash(d.total) },
    ];
    case "expenses": return [
      { label: "This month", value: cash(d.month), strong: true, tone: "neg" },
      { label: "Year to date", value: cash(d.year) },
      { label: "All time", value: cash(d.total) },
    ];
    case "pnl": {
      const mm = N(d.income_month) - N(d.expense_month), yy = N(d.income_year) - N(d.expense_year);
      return [
        { label: "Income (m)", value: cash(d.income_month), tone: "pos" },
        { label: "Expense (m)", value: cash(d.expense_month), tone: "neg" },
        { label: mm >= 0 ? "Profit (m)" : "Loss (m)", value: cash(Math.abs(mm)), strong: true, tone: mm >= 0 ? "pos" : "neg" },
        { label: yy >= 0 ? "Profit (ytd)" : "Loss (ytd)", value: cash(Math.abs(yy)), tone: yy >= 0 ? "pos" : "neg" },
      ];
    }
    case "car_balances": return [
      { label: "Due", value: cash(d.due_this_month), tone: "warn" },
      { label: "Overdue", value: cash(d.overdue), tone: N(d.overdue) > 0 ? "neg" : undefined },
      { label: "Outstd.", value: cash(d.outstanding), strong: true },
      { label: "Collected", value: cash(d.collected), tone: "pos" },
    ];
    case "pending_sales_orders":
    case "pending_purchase_orders": return [
      { label: "Orders", value: qty(d.count), strong: true, tone: N(d.count) > 0 ? "warn" : undefined },
      { label: "Value", value: cash(d.value) },
      { label: "Oldest", value: raw(dateStr(d.oldest)) },
    ];
    case "order_status": return [
      { label: "SO qty", value: qty(d.so_qty) },
      { label: "Stock", value: qty(d.stock_qty) },
      { label: "PO qty", value: qty(d.po_qty) },
      { label: "Balance", value: qty(d.balance), strong: true, tone: N(d.balance) < 0 ? "neg" : "pos" },
    ];
    case "so_advance_receipt": return [
      { label: "Order", value: cash(d.order_value), strong: true },
      { label: "Advance", value: cash(d.advance) },
      { label: "Received", value: cash(d.received), tone: "pos" },
      { label: "Balance", value: cash(d.balance), tone: N(d.balance) > 0 ? "warn" : undefined },
    ];
    case "purchase_vs_sale": {
      const gm = N(d.sale_month) - N(d.purchase_month);
      return [
        { label: "Buy (m)", value: cash(d.purchase_month) },
        { label: "Sale (m)", value: cash(d.sale_month) },
        { label: "Margin (m)", value: cash(gm), strong: true, tone: gm >= 0 ? "pos" : "neg" },
        { label: "Sale (ytd)", value: cash(d.sale_year) },
      ];
    }
    case "stock": return [
      { label: "Value", value: cash(d.value), strong: true },
      { label: "Quantity", value: qty(d.qty) },
      { label: "Items", value: qty(d.items) },
    ];
    case "bookings": return [
      { label: "Total", value: qty(d.total), strong: true },
      { label: "Pending", value: qty(d.pending), tone: N(d.pending) > 0 ? "warn" : undefined },
      { label: "Confirmed", value: qty(d.confirmed), tone: "info" },
      { label: "In today", value: qty(d.checkin_today) },
    ];
    case "delivery_status": return [
      { label: "Sold", value: qty(d.sold), strong: true },
      { label: "Delivered", value: qty(d.delivered), tone: "pos" },
      { label: "To deliver", value: qty(d.balance), tone: N(d.balance) > 0 ? "warn" : undefined },
      { label: "In stock", value: qty(d.in_stock) },
    ];
    case "approvals": return [
      { label: "Waiting", value: qty(d.pending), strong: true, tone: N(d.pending) > 0 ? "warn" : undefined },
      { label: "Value", value: cash(d.amount) },
    ];
    case "pdc": return [
      { label: "Pending", value: qty(d.pending), strong: true },
      { label: "Due ≤ 14d", value: qty(d.due_soon), tone: N(d.due_soon) > 0 ? "warn" : undefined },
      { label: "Value", value: cash(d.amount) },
    ];
    case "car_contracts": return [
      { label: "Contracts", value: qty(d.total), strong: true },
      { label: "Active", value: qty(d.active), tone: "info" },
      { label: "Completed", value: qty(d.completed), tone: "pos" },
      { label: "Value", value: cash(d.value) },
    ];
    case "car_service_charges": return [
      { label: "This month", value: cash(d.this_month), strong: true },
      { label: "Outstd.", value: cash(d.outstanding) },
      { label: "Overdue", value: cash(d.overdue), tone: N(d.overdue) > 0 ? "neg" : undefined },
    ];
    case "car_ownership": return [
      { label: "Vehicles", value: qty(d.total), strong: true },
      { label: "Transf.", value: qty(d.transferred) },
      { label: "Vista", value: qty(d.vista) },
      { label: "Held", value: qty(d.held), tone: N(d.held) > 0 ? "neg" : undefined },
    ];
    case "hotel_financials": return [
      { label: "Sales", value: cash(d.sales) },
      { label: "Purchase", value: cash(d.purchase) },
      { label: "Profit", value: cash(d.profit), strong: true, tone: N(d.profit) >= 0 ? "pos" : "neg" },
      { label: "HCN due", value: qty(d.hcn_pending), tone: N(d.hcn_pending) > 0 ? "neg" : undefined },
    ];
    case "brn_beds": return [
      { label: "Occupancy", value: raw(`${N(d.occupancy)}%`), strong: true, tone: N(d.occupancy) > 90 ? "neg" : "info" },
      { label: "Bought", value: qty(d.purchased) },
      { label: "Reserved", value: qty(d.reserved) },
    ];
    case "brn_availability": return [
      { label: "Makkah", value: qty(d.makkah), strong: true, tone: "pos" },
      { label: "Madinah", value: qty(d.madinah), tone: "pos" },
      { label: "In today", value: qty(d.checkin_today) },
      { label: "Out today", value: qty(d.checkout_today) },
    ];
    case "brn_agreements": return [
      { label: "Active", value: qty(d.active), strong: true },
      { label: "Exp ≤7d", value: qty(d.expiring), tone: N(d.expiring) > 0 ? "warn" : undefined },
      { label: "All BRNs", value: qty(d.total) },
      { label: "Suppl. due", value: cash(d.supplier_outstanding), tone: N(d.supplier_outstanding) > 0 ? "neg" : undefined },
    ];
    case "transport": return [
      { label: "Revenue", value: cash(d.revenue), strong: true },
      { label: "Pending", value: qty(d.pending), tone: N(d.pending) > 0 ? "warn" : undefined },
      { label: "Running", value: qty(d.in_progress), tone: "info" },
      { label: "No driver", value: qty(d.unassigned), tone: N(d.unassigned) > 0 ? "neg" : undefined },
    ];
    case "visa_groups": return [
      { label: "Groups", value: qty(d.total), strong: true },
      { label: "In process", value: qty(d.process), tone: "info" },
      { label: "Issued", value: qty(d.issued), tone: "pos" },
      { label: "Waiting", value: qty(d.waiting_brn), tone: N(d.waiting_brn) > 0 ? "warn" : undefined },
    ];
    default: return [];
  }
}

export default function DashboardCard({ def, metrics }: { def: CardDef; metrics: any }) {
  const list = cells(def.key, metrics);
  const body = (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-pop">
      <header className="flex items-center justify-between gap-2 border-b border-brand-100 bg-brand-50/70 px-3 py-1.5">
        <h3 className="truncate text-[11px] font-bold uppercase tracking-wider text-brand-800">{def.label}</h3>
        {def.href && (
          <span className="shrink-0 text-brand-400 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>›</span>
        )}
      </header>
      <div className="flex flex-1 flex-wrap divide-slate-100">
        {list.map((c, i) => (
          <div key={c.label}
               className={`min-w-[4.75rem] flex-1 basis-0 px-2.5 py-2 ${i > 0 ? "border-l border-slate-100" : ""}`}>
            <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-slate-400">{c.label}</p>
            <p title={c.value.title}
               className={`mt-0.5 truncate tabular-nums ${c.strong ? "text-xl font-extrabold" : "text-lg font-semibold"} ${c.tone ? TONE[c.tone] : "text-slate-800"}`}>
              {c.value.text}
            </p>
          </div>
        ))}
        {list.length === 0 && <p className="px-3 py-4 text-sm text-slate-400">No data.</p>}
      </div>
    </article>
  );
  return def.href ? <Link href={def.href} className="block h-full">{body}</Link> : body;
}
