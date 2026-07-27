import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import RouteRatesManager from "./RouteRatesManager";

export const dynamic = "force-dynamic";

export default async function RouteRatesPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: route }, { data: vehicles }, { data: rates }] = await Promise.all([
    supabase.from("transport_routes").select("id, name, from_location, to_location").eq("id", params.id).maybeSingle(),
    supabase.from("transport_vehicles").select("id, name, category, is_active").order("sort_order").order("name"),
    supabase.from("transport_route_rates").select("id, vehicle_id, sell_rate, currency, is_active").eq("route_id", params.id),
  ]);

  if (!route) {
    return <div className="card text-slate-500">Route not found. <Link href="/transport/routes" className="text-brand hover:underline">Back to routes</Link></div>;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Rates — ${(route as any).name}`} />
      <p className="mb-4 text-sm text-slate-500">
        Set a selling rate per vehicle for this route. <Link href="/transport/routes" className="text-brand hover:underline">← All routes</Link>
      </p>
      <RouteRatesManager
        routeId={params.id}
        vehicles={(vehicles as any[]) ?? []}
        initial={(rates as any[]) ?? []}
      />
    </div>
  );
}
