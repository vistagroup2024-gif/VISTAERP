import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import RouteManager from "./RouteManager";

export const dynamic = "force-dynamic";

export default async function RoutesPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("transport_routes")
    .select("id, name, from_location, to_location, distance_km, driving_minutes, rest_minutes, is_active, created_at")
    .order("name");

  return (
    <div className="max-w-5xl">
      <PageHeader title="Routes" />
      <p className="mb-4 text-sm text-slate-500">
        Every transport route. <b>Driving time</b> and <b>rest requirement</b> feed the automatic driver
        scheduling engine. Open a route to set its per-vehicle rates.
      </p>
      <RouteManager initial={(rows as any[]) ?? []} />
    </div>
  );
}
