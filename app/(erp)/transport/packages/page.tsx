import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import PackageManager from "./PackageManager";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const supabase = createClient();
  const [{ data: packages }, { data: vehicles }] = await Promise.all([
    supabase.from("transport_packages")
      .select("id, name, package_type, duration_days, vehicle_id, price, currency, is_active")
      .order("name"),
    supabase.from("transport_vehicles").select("id, name").order("name"),
  ]);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Transport Packages" />
      <p className="mb-4 text-sm text-slate-500">
        Complete transport packages. The package price is <b>independent</b> of individual route rates.
        Open a package to build its included trips.
      </p>
      <PackageManager initial={(packages as any[]) ?? []} vehicles={(vehicles as any[]) ?? []} />
    </div>
  );
}
