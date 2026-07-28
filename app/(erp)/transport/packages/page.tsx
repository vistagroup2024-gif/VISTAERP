import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import PackageManager from "./PackageManager";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const supabase = createClient();
  const { data: packages } = await supabase
    .from("transport_packages")
    .select("id, name, package_type, is_active")
    .order("name");

  return (
    <div className="max-w-4xl">
      <PageHeader title="Transport Packages" />
      <p className="mb-4 text-sm text-slate-500">
        Define a package name and type. Open a package to build its included trips and set its
        <b> per-vehicle prices</b>.
      </p>
      <PackageManager initial={(packages as any[]) ?? []} />
    </div>
  );
}
