import { createClient } from "@/lib/supabase/server";
import { dateStr } from "@/lib/format";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import Icon from "@/components/ui/Icon";
import DashboardCard, { cardSpan } from "@/components/dashboard/DashboardCard";
import ReportQuickLinks from "@/components/dashboard/ReportQuickLinks";
import TripAlerts from "@/components/transport/TripAlerts";
import { TRIP_ALERT_PERMS } from "@/lib/tripAlerts";
import { visibleCards, type CardAccess, type CardKey } from "@/lib/dashboardCards";
import { reportCategories } from "@/lib/reportQuickLinks";
import { getStaffAccess, staffCan, staffLanding, getSessionUser } from "@/lib/staffSession";
import { redirect } from "next/navigation";
import { todaySA, monthStartSA } from "@/lib/saudiTime";

export const dynamic = "force-dynamic";

// The one dashboard. Every card the business looks at is here, ALL together
// on one page — no tabs splitting them up. The old VISTA software's tabs
// organised its reporting/detail SCREENS, not the dashboard's own KPI cards;
// a card here is the summary layer, and stays visible alongside every other
// card the user may see. Nobody has to walk round the module dashboards, or
// click through a tab, to see where things stand — the modules keep their
// own screens for the detail behind each number.
//
// Which cards a user sees is set per user (Users → Dashboard). An admin sees
// them all; everyone else sees what has been ticked — the opposite of the other
// access maps, because a dashboard shows the whole company's money at once.
export default async function Dashboard() {
  const supabase = createClient();
  const user = await getSessionUser();

  const access = await getStaffAccess();
  if (!staffCan(access, "dashboard.view")) {
    const dest = staffLanding(access);
    if (dest !== "/dashboard") redirect(dest);
  }

  const cards = visibleCards(access.dashboardCards as CardAccess);
  // The trip alerts go to whoever runs operations, whatever cards they hold —
  // an alert nobody who can act on it sees is not an alert.
  const tripAlerts = TRIP_ALERT_PERMS.some((k) => staffCan(access, k));
  // Quick-access report shortcuts, same visibility rule as everywhere else:
  // a category only shows for someone who could already reach it from the
  // sidebar or the dashboard's own cards.
  const reportCats = reportCategories().filter((c) => staffCan(access, c.perm));

  // Two calls cover every card — the money and trade figures, and the ones the
  // module dashboards used to carry — so they go out together rather than one
  // waiting on the other.
  const [{ data: prof }, { data: metrics }, { data: moduleMetrics }] = await Promise.all([
    supabase.from("profiles").select("company_id").eq("id", user!.id).maybeSingle(),
    cards.length ? supabase.rpc("dashboard_metrics") : Promise.resolve({ data: null }),
    cards.length ? supabase.rpc("dashboard_module_metrics") : Promise.resolve({ data: null }),
  ]);
  const noCompany = !(prof as any)?.company_id;
  const m = { ...((metrics as any) ?? {}), ...((moduleMetrics as any) ?? {}) };

  // Sales / Expenses / P&L show a strong "this month" figure, so their
  // click-through lands on that same month rather than the destination
  // report's own default — computed per request, since "this month" is not
  // something a static href can carry. NOTE: none of these three screens
  // actually reads ?from=&to= yet (SalesReportView/ProfitLossView both
  // default their own PeriodDropdown state with no searchParams awareness),
  // so today this only sets the URL, not what the report shows — a real
  // gap, not a deliberate no-op, left for when that plumbing is added.
  // Cash Flow used to have its own override here pointing at the OLD
  // ledger-filter href, a second definition of the same card that silently
  // outlived the fix made to its real one in lib/dashboardCards.ts — this
  // is exactly the two-places-written-down trap this file's own CLAUDE.md
  // keeps flagging elsewhere; removed rather than corrected in place, so
  // there is only one href for this card to ever drift out of step again.
  const period = `from=${monthStartSA()}&to=${todaySA()}`;
  const hrefOverride: Partial<Record<CardKey, string>> = {
    sales: `/accounting/sales-report?${period}`,
    pnl: `/accounting/profit-loss?${period}`,
  };

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["umrah_groups", "brn_inventory", "brn_consumption", "group_brn_allocation"]} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-extrabold uppercase tracking-wide text-slate-800">Dashboard</h1>
          <span className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-bold tabular-nums text-brand-700">
            {dateStr(m.as_of ?? todaySA())}
          </span>
        </div>
        <p className="text-xs text-slate-400">
          {cards.length} card{cards.length === 1 ? "" : "s"} · figures are live, month and year to date where shown
        </p>
      </div>

      {tripAlerts && <TripAlerts canAct />}

      <ReportQuickLinks categories={reportCats} />

      {noCompany && (
        <div className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-soft/50 px-4 py-3 text-sm text-warning-fg">
          <Icon name="bell" size={16} className="mt-0.5 shrink-0" />
          <span>Your account isn’t linked to a company yet, so data is hidden by row-level security. An admin must set your <code>company_id</code> in <code>profiles</code>.</span>
        </div>
      )}

      {cards.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          <p className="font-medium text-slate-700">No dashboard cards have been shared with you yet.</p>
          <p className="mt-1 text-slate-400">
            An administrator chooses which cards each user can see, under Users → the user → Dashboard.
          </p>
        </div>
      ) : (
        <div className="grid grid-flow-row-dense grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {cards.map((def) => {
            const withHref = hrefOverride[def.key] ? { ...def, href: hrefOverride[def.key] } : def;
            return (
              <div key={def.key} className={cardSpan(def, m)}>
                <DashboardCard def={withHref} metrics={m} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
