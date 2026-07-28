import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import RouteManager from "./RouteManager";

export const dynamic = "force-dynamic";

export default async function RoutesPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("transport_routes")
    .select("id, name, distance_km, driving_minutes, is_airport, is_active, created_at")
    .order("name");

  return (
    <div className="max-w-5xl">
      <PageHeader title="Routes" />
      <p className="mb-4 text-sm text-slate-500">
        Every transport route. <b>Driving time</b> feeds the automatic driver scheduling engine.
        Rates are managed separately in the <b>Rate Master</b>.
      </p>
      <RouteManager initial={(rows as any[]) ?? []} />
    </div>
  );
}
