// Quick-access report navigation for the dashboard — a compact bar of
// category shortcuts sitting ABOVE the 26 cards, not another way of
// dividing them. Every href here is an existing screen; nothing is built
// twice. Categories with several separate report routes (Accounting,
// Sales & Purchase, Stock — none of which has one landing page of its own)
// resolve their items through navItemFor(), the same "read the label back
// out of GROUPS" convention the header's own Transactions quick menu
// already uses, so a label here can never drift from the sidebar's. The
// three modules that already have one consolidated reports screen
// (Car Sales, Hotels, Transport) link straight to it instead of repeating
// its own contents here.
import { navItemFor, HIDDEN_ITEMS } from "@/lib/nav";
import type { IconName } from "@/components/ui/Icon";

// navItemFor() only reads GROUPS/EXTRA_ITEMS; /car-sales/reports is a
// hidden-module entry (still built, still posting — see HIDDEN_ITEMS in
// lib/nav.ts), so its label is read back from there instead of retyped.
function labelFor(href: string): string {
  return navItemFor(href)?.label ?? HIDDEN_ITEMS.find((h) => h.href === href)?.label ?? "Reports";
}

export type ReportCategory =
  | { kind: "menu"; label: string; icon: IconName; perm: string; items: { href: string; label: string }[] }
  | { kind: "link"; label: string; icon: IconName; perm: string; href: string; itemLabel: string };

function resolve(hrefs: string[]): { href: string; label: string }[] {
  return hrefs
    .map((href) => {
      const it = navItemFor(href);
      return it ? { href, label: it.label } : null;
    })
    .filter((x): x is { href: string; label: string } => !!x);
}

const ACCOUNTING_REPORT_HREFS = [
  "/accounting/trial-balance", "/accounting/balance-sheet", "/accounting/profit-loss",
  "/accounting/ledger", "/accounting/aging", "/accounting/cash-bank", "/accounting/cash-flow",
  "/accounting/journal", "/accounting/transactions", "/accounting/cost-centre-costing",
  "/accounting/targets", "/accounting/drawings", "/accounting/product-costing",
  "/accounting/vat", "/accounting/assets", "/accounting/audit",
];

const SALES_PURCHASE_REPORT_HREFS = [
  "/accounting/sales-report", "/accounting/sales/orders-report", "/accounting/sales/advance-vs-receipt",
  "/accounting/purchase-report", "/accounting/purchases/orders-report", "/accounting/purchase-vs-sale",
];

const STOCK_REPORT_HREFS = [
  "/stock/ledger", "/stock/opening", "/stock/statement", "/stock/movement", "/stock/multilevel",
  "/stock/virtual", "/stock/valuation", "/stock/abc", "/stock/ageing", "/stock/reorder",
  "/stock/fast-moving", "/stock/slow-moving", "/stock/peak-low",
];

export function reportCategories(): ReportCategory[] {
  return [
    { kind: "menu", label: "Accounting Reports", icon: "accounting", perm: "accounting.view",
      items: resolve(ACCOUNTING_REPORT_HREFS) },
    { kind: "menu", label: "Sales & Purchase Reports", icon: "sales", perm: "accounting.view",
      items: resolve(SALES_PURCHASE_REPORT_HREFS) },
    { kind: "menu", label: "Stock Reports", icon: "inventory", perm: "accounting.view",
      items: resolve(STOCK_REPORT_HREFS) },
    // Transport, Car Sales and Hotels each already have their own single
    // "Reports" landing screen — one click lands there, the same way it
    // already does from the sidebar, instead of this bar repeating its
    // contents in a second menu.
    { kind: "link", label: "Transport / Booking Reports", icon: "transport", perm: "transport.reports",
      href: "/transport/reports", itemLabel: labelFor("/transport/reports") },
    // Car Sales is a hidden module (still built, still posting) — its
    // reports index carries its own permission and is reachable the same
    // way the dashboard's own car-sales cards already reach it.
    { kind: "link", label: "Car Sales / Car Customer Reports", icon: "car", perm: "carsales.reports",
      href: "/car-sales/reports", itemLabel: labelFor("/car-sales/reports") },
    { kind: "link", label: "Hotel / BRN Reports", icon: "hotel", perm: "hotels.reports",
      href: "/hotels/reports", itemLabel: labelFor("/hotels/reports") },
  ];
}
