import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import PackageBuilder from "./PackageBuilder";
import PackagePrices from "./PackagePrices";

export const dynamic = "force-dynamic";

export default async function PackageBuilderPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: pkg }, { data: legs }, { data: routes }, { data: vehicles }, { data: prices }, { data: agents }] = await Promise.all([
    supabase.from("transport_packages").select("id, name, package_type, price, currency").eq("id", params.id).maybeSingle(),
    supabase.from("transport_package_legs").select("id, seq, route_id, label, vehicle_id").eq("package_id", params.id).order("seq"),
    supabase.from("transport_routes").select("id, name").eq("is_active", true).order("name"),
    supabase.from("transport_vehicles").select("id, name, category, is_active").order("sort_order").order("name"),
    // effective_from comes too: a package price is a dated row now, so the editor
    // shows what is in force on a chosen date rather than "the" price.
    supabase.from("transport_package_prices").select("id, vehicle_id, price, agent_id, effective_from, effective_to, status").eq("package_id", params.id),
    supabase.from("parties").select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name"),
  ]);

  if (!pkg) {
    return <div className="card text-slate-500">Package not found. <Link href="/transport/packages" className="text-brand hover:underline">Back</Link></div>;
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title={`Build — ${(pkg as any).name}`} />
      <p className="mb-4 text-sm text-slate-500">
        Add the trips included in this package, in order. <Link href="/transport/packages" className="text-brand hover:underline">← All packages</Link>
      </p>
      <PackageBuilder
        packageId={params.id}
        initial={(legs as any[]) ?? []}
        routes={(routes as any[]) ?? []}
        vehicles={(vehicles as any[]) ?? []}
      />

      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">Price per Vehicle</h2>
      <p className="mb-3 text-sm text-slate-500">Set the <b>Standard</b> price per vehicle, or pick an agent to give them a different package price. The booking uses the selected agent&rsquo;s price when set, otherwise the standard price.
        Prices are <b>effective-dated</b>: saving writes a price that starts on the date you choose and leaves the earlier one as history, so next season&rsquo;s prices can be entered now.</p>
      <PackagePrices packageId={params.id} vehicles={(vehicles as any[]) ?? []} initial={(prices as any[]) ?? []}
        agents={((agents as any[]) ?? []).map((a) => ({ id: a.id, agency_name: a.name }))} />
    </div>
  );
}
