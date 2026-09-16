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
    case "cash_flow": return [
      { label: "In (m)", value: cash(d.in_month), tone: "pos" },
      { label: "Out (m)", value: cash(d.out_month), tone: "neg" },
      { label: "Net (m)", value: cash(d.net_month), strong: true, tone: N(d.net_month) >= 0 ? "pos" : "neg" },
      { label: "Net (ytd)", value: cash(d.net_year), tone: N(d.net_year) >= 0 ? "pos" : "neg" },
    ];
    case "balance_sheet": {
      const diff = N(d.difference);
      return [
        { label: "Assets", value: cash(d.assets), strong: true },
        { label: "Liabilities", value: cash(d.liabilities), tone: "neg" },
        { label: "Equity", value: cash(d.equity) },
        { label: N(d.profit) >= 0 ? "Profit" : "Loss", value: cash(Math.abs(N(d.profit))), tone: N(d.profit) >= 0 ? "pos" : "neg" },
        // A balance sheet that does not balance is the only thing worth shouting
        // about on this card, so it is the one cell that changes colour.
        { label: "Difference", value: cash(diff), tone: Math.abs(diff) > 0.005 ? "neg" : "pos" },
      ];
    }
    case "ar_ap": return [
      { label: "Receivable", value: cash(d.ar), tone: "pos" },
      { label: "Payable", value: cash(d.ap), tone: "neg" },
      { label: "Overdue", value: cash(d.overdue), tone: N(d.overdue) > 0 ? "warn" : undefined },
      { label: "Net", value: cash(d.net), strong: true, tone: N(d.net) >= 0 ? "pos" : "neg" },
    ];
    case "sales": return [
      { label: "This month", value: cash(d.month), strong: true },
      { label: "YTD", value: cash(d.year) },
      { label: "Invoices (m)", value: qty(d.invoices_month) },
    ];
    case "expenses": return [
      { label: "This month", value: cash(d.month), strong: true, tone: "neg" },
      { label: "YTD", value: cash(d.year) },
      { label: "All time", value: cash(d.total) },
    ];
    case "pnl": {
      // Income and Expense already have their own cards — this one is the
      // BOTTOM LINE those two combine into, not a third place showing the
      // same input figures. Gross Profit is the one step of the calculation
      // neither of those cards carries (income less cost of sales); Net
      // Profit/Margin/YTD are what "how is the business doing" actually asks.
      const gm = N(d.income_month) - N(d.cogs_month);
      const mm = gm - N(d.expense_month), yy = N(d.income_year) - N(d.cogs_year) - N(d.expense_year);
      const marginPct = N(d.income_month) !== 0 ? (mm / N(d.income_month)) * 100 : null;
      return [
        { label: "Gross Profit", value: cash(gm), tone: gm >= 0 ? "pos" : "neg" },
        { label: mm >= 0 ? "Net Profit" : "Net Loss", value: cash(Math.abs(mm)), strong: true, tone: mm >= 0 ? "pos" : "neg" },
        { label: "Net Margin", value: raw(marginPct === null ? "—" : `${marginPct.toFixed(1)}%`) },
        { label: yy >= 0 ? "Net Profit YTD" : "Net Loss YTD", value: cash(Math.abs(yy)), tone: yy >= 0 ? "pos" : "neg" },
      ];
    }
    // Everything a car customer owes, in one card: the instalments, the advance
    // on the invoice, and the monthly service charge — all money from the same
    // customer against the same car, so there is no separate charges card.
    // Due and Overdue are DISJOINT. Due is anything whose date has arrived and
    // whose month has not ended; Overdue is anything whose month has ended.
    // Total is the two added, which is only sound because they cannot overlap.
    // Ledger Balance is read off the customers' accounts, NOT the instalment
    // schedule — the schedule leaves the advance out, so it never was what
    // they owe.
    case "car_balances": return [
      { label: "Due", value: cash(d.due_this_month), tone: "warn" },
      { label: "Overdue", value: cash(d.overdue), tone: N(d.overdue) > 0 ? "neg" : undefined },
      { label: "Total", value: cash(N(d.due_this_month) + N(d.overdue)), strong: true,
        tone: N(d.due_this_month) + N(d.overdue) > 0 ? "warn" : undefined },
      { label: "Ledger Balance", value: cash(d.balance) },
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
    // Sale orders still AWAITING their invoice — one drops off the moment a Car
    // Invoice is raised from it. Advance is the one agreed ON THE ORDER, in its
    // Car Sales Details. Balance is the ADVANCE still to come in, not the order
    // less everything paid.
    case "so_advance_receipt": return [
      { label: "Order", value: cash(d.order_value), strong: true },
      { label: "Advance", value: cash(d.advance) },
      { label: "Received", value: cash(d.received), tone: "pos" },
      { label: "Balance", value: cash(d.balance), tone: N(d.balance) > 0 ? "warn" : undefined },
    ];
    // Inventory MOVEMENT, not money and not a transaction count — Sales and
    // P&L already carry the revenue and margin figures, so this card asks a
    // different question: how many physical units came in, how many went
    // out, and how many are left. Purchased/Sold read the stock ledger the
    // same way stock_statement() does per item (receipts vs issues),
    // summed across every physical item including cars, which post through
    // the same ledger one unit at a time. Remaining is today's on-hand
    // count — the FLOW this month against the Stock card's own BALANCE, the
    // same pairing Cash Flow already is to Cash & Bank.
    case "purchase_vs_sale": return [
      { label: "Purchased Qty", value: qty(d.purchased_qty_month), strong: true, tone: "pos" },
      { label: "Sold Qty", value: qty(d.sold_qty_month), tone: "info" },
      { label: "Remaining Qty", value: qty(d.remaining_qty) },
    ];
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
    case "car_ownership": return [
      { label: "Vehicles", value: qty(d.total), strong: true },
      { label: "Transf.", value: qty(d.transferred) },
      { label: "Vista", value: qty(d.vista) },
      { label: "Held", value: qty(d.held), tone: N(d.held) > 0 ? "neg" : undefined },
      { label: "Vista value", value: cash(d.vista_value) },
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
      // Trips nobody pressed Start / Picked Up / Complete on (migration 375).
      { label: "Alerts", value: qty(d.alerts), tone: N(d.alerts) > 0 ? "neg" : undefined },
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

// A compact grid of cells rather than a flex row that wraps: a fixed column
// count means a busy card is always exactly the same shape, never an
// unpredictable wrap that depends on how wide its own column happens to be —
// which is what made the old flex-wrap layout run tall on some breakpoints
// and not others for the same card. 1px gaps + a white cell background on a
// slate-100 grid is the divider, so no separate border classes are needed.
// 4 cells go 2×2 rather than 3-then-1 — a lone fourth cell under three full
// ones was the awkward half-empty row this is fixing; every other count
// still reads best across three.
export default function DashboardCard({ def, metrics }: { def: CardDef; metrics: any }) {
  const list = cells(def.key, metrics);
  const cols = list.length === 4 || list.length <= 2 ? "grid-cols-2" : "grid-cols-3";
  const body = (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-pop">
      <header className="flex items-start justify-between gap-2 border-b border-brand-100 bg-brand-50/70 px-2 py-1">
        <h3 className="line-clamp-2 break-words text-[10px] font-bold uppercase tracking-wide text-brand-800">{def.label}</h3>
        {def.href && (
          <span className="shrink-0 text-brand-400 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden>›</span>
        )}
      </header>
      <div className={`grid flex-1 ${cols} gap-px overflow-hidden bg-slate-100`}>
        {list.map((c) => (
          <div key={c.label} className="bg-white px-2 py-1">
            {/* Two lines, never an ellipsis — a label cut to "YEAR TO DA…"
               forces a guess; wrapping it costs a few px of height instead.
               min-h reserves that second line's space on every cell so a
               row stays level whether or not that particular label needs it. */}
            <p className="line-clamp-2 min-h-[19px] break-words text-[9px] font-medium uppercase leading-tight tracking-wide text-slate-400">{c.label}</p>
            <p title={c.value.title}
               className={`truncate tabular-nums ${c.strong ? "text-base font-extrabold" : "text-sm font-semibold"} ${c.tone ? TONE[c.tone] : "text-slate-800"}`}>
              {c.value.text}
            </p>
          </div>
        ))}
        {list.length === 0 && <p className="col-span-full bg-white px-3 py-4 text-sm text-slate-400">No data.</p>}
      </div>
    </article>
  );
  return def.href ? <Link href={def.href} className="block h-full">{body}</Link> : body;
}
