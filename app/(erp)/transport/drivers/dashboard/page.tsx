import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import { guardStaffPage } from "@/lib/staffSession";
import DriverDashboard from "./DriverDashboard";

export const dynamic = "force-dynamic";

export default async function DriverDashboardPage() {
  await guardStaffPage("transport.operations");
  const sb = createClient();
  const [{ data: rows }, { data: routes }] = await Promise.all([
    sb.rpc("transport_driver_board"),
    sb.from("transport_routes").select("name, distance_km").eq("is_active", true).order("name"),
  ]);
  // Location suggestions for the Move Driver form: canonical cities + route endpoints.
  const locs = new Set<string>(["Makkah", "Madinah", "Jeddah", "Jeddah Airport", "Madinah Airport", "Taif", "Riyadh"]);
  (routes ?? []).forEach((r: any) => (r.name ?? "").split(" - ").forEach((p: string) => p.trim() && locs.add(p.trim())));
  return (
    <div className="space-y-4">
      <RealtimeRefresh tables={["transport_trips", "transport_driver_movements"]} pollMs={20000} />
      <PageHeader title="Driver Dashboard" action={{ href: "/transport/operations", label: "Operations" }} />
      <DriverDashboard rows={(rows as any[]) ?? []} locations={Array.from(locs).sort()} />
    </div>
  );
}
