import { createClient } from "@/lib/supabase/server";
import { dateStr } from "@/lib/format";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import Icon from "@/components/ui/Icon";
import DashboardCard from "@/components/dashboard/DashboardCard";
import { visibleCards, type CardAccess } from "@/lib/dashboardCards";
import { getStaffAccess, staffCan, staffLanding, getSessionUser } from "@/lib/staffSession";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// The one dashboard. Every card the business looks at is here, so nobody has to
// walk round the module dashboards to see where things stand; the modules keep
// their own screens for the detail behind each number.
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

  const [{ data: prof }, { data: metrics }] = await Promise.all([
    supabase.from("profiles").select("company_id").eq("id", user!.id).maybeSingle(),
    // Every figure on the page in one call.
    cards.length ? supabase.rpc("dashboard_metrics") : Promise.resolve({ data: null }),
  ]);
  // The module dashboards' figures live here too, so those screens could go.
  const { data: moduleMetrics } = cards.length
    ? await supabase.rpc("dashboard_module_metrics")
    : { data: null };
  const noCompany = !(prof as any)?.company_id;
  const m = { ...((metrics as any) ?? {}), ...((moduleMetrics as any) ?? {}) };

  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["umrah_groups", "brn_inventory", "brn_consumption", "group_brn_allocation"]} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-extrabold uppercase tracking-wide text-slate-800">Dashboard</h1>
          <span className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1 text-sm font-bold tabular-nums text-brand-700">
            {dateStr(m.as_of ?? new Date().toISOString().slice(0, 10))}
          </span>
        </div>
        <p className="text-xs text-slate-400">
          {cards.length} card{cards.length === 1 ? "" : "s"} · figures are live, month and year to date where shown
        </p>
      </div>

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {cards.map((def) => <DashboardCard key={def.key} def={def} metrics={m} />)}
        </div>
      )}
    </div>
  );
}
