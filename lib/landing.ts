// Where a user goes when they may not be where they asked for.
//
// This lived in two places — lib/staffSession.ts for the server-page guard and
// lib/supabase/middleware.ts for the route guard — and the two drifted: the
// middleware knew about Car Sales, visa invoices, parties and the trip ledger,
// the page guard did not, so the same user could be sent to two different
// screens depending on which gate caught them (and a Car Sales user hit
// /no-access from one of them). One table now, imported by both.
//
// No imports of its own on purpose: the middleware runs on the edge runtime and
// must not pull in the Supabase server client through this.
//
// Two rules for anything added here:
//   - never a route that forwards (/accounting, /car-sales, /transport,
//     /inventory, /hotels/dashboard all redirect to /dashboard, so a user
//     without dashboard.view would bounce between the two forever);
//   - never a screen hidden from the sidebar, or the user lands somewhere with
//     no way back into their own menu.
export const LANDING: [string, string][] = [
  ["dashboard.view", "/dashboard"],
  ["visa.view", "/groups"],
  ["visa.invoices", "/visa/invoices"],
  ["visa.package_update", "/groups/package-updates"],
  ["brn.view", "/inventory/brn"],
  ["brn.planning", "/inventory/planning"],
  ["transport.bookings", "/transport/bookings"],
  ["transport.operations", "/transport/operations"],
  ["transport.masters", "/transport/routes"],
  ["transport.vehicles", "/transport/vehicles"],
  ["transport.reports", "/transport/reports"],
  ["transport.trip_ledger", "/transport/reports/ledger"],
  ["hotels.bookings", "/hotels/bookings"],
  ["hotels.masters", "/hotels"],
  ["hotels.suppliers", "/hotels/suppliers"],
  ["hotels.reports", "/hotels/reports"],
  // Car Sales is hidden apart from its two invoice screens, which are still in
  // Transactions -> Sales — so those are the only car landings left. A user whose
  // ONLY permission is carsales.view, .vehicles or .reports has no screen in any
  // menu now, and falls through to /no-access rather than being dropped on one
  // they cannot navigate away from.
  ["carsales.sales", "/car-sales/contracts"],
  ["carsales.installments", "/car-sales/contracts"],
  ["carsales.charges", "/car-sales/service-charges"],
  ["sales.view", "/accounting/sales/orders"],
  ["parties.manage", "/parties"],
  ["accounting.view", "/accounting/accounts"],
  ["purchase.view", "/purchase/bills"],
  ["users.view", "/settings/users"],
  // A delegated user manager may hold only this one: without it here they would
  // be sent to /no-access from the very screen they administer people on.
  ["users.manage_roles", "/settings/users"],
  ["system.companies", "/settings/companies"],
];

export function landingFor(perms: Record<string, boolean>): string {
  for (const [key, dest] of LANDING) if (perms[key]) return dest;
  return "/no-access";
}
