import { createClient } from "@/lib/supabase/server";
import { dateStr } from "@/lib/format";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import Icon from "@/components/ui/Icon";
import DashboardCard from "@/components/dashboard/DashboardCard";
import { CARD_GROUPS, visibleCards, type CardAccess } from "@/lib/dashboardCards";
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
  const noCompany = !(prof as any)?.company_id;
  const m = (metrics as any) ?? {};

  return (
    <div className="space-y-6">
      <RealtimeRefresh tables={["umrah_groups", "brn_inventory", "brn_consumption", "group_brn_allocation"]} />

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Business at a glance · {dateStr(m.as_of ?? new Date().toISOString().slice(0, 10))}
          </p>
        </div>
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
        CARD_GROUPS.map((group) => {
          const inGroup = cards.filter((c) => c.group === group);
          if (!inGroup.length) return null;
          return (
            <section key={group} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{group}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {inGroup.map((def) => <DashboardCard key={def.key} def={def} metrics={m} />)}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
