import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DriverManager from "./DriverManager";

export const dynamic = "force-dynamic";

export default async function DriversPage() {
  const supabase = createClient();
  const [{ data: drivers }, { data: vehicles }, { data: vistaVehicles }] = await Promise.all([
    supabase.from("transport_drivers")
      .select("id, name, iqama, license_no, tafweej_reg, mobile, vehicle_id, vista_vehicle_reg, languages, status, emergency_contact, iqama_expiry, license_expiry, nusuk_registered, base_city, username, portal_enabled")
      .order("name"),
    supabase.from("transport_vehicles").select("id, name").order("name"),
    supabase.rpc("transport_vista_vehicles", { p_company: COMPANY_ID }),
  ]);

  return (
    <div className="max-w-6xl">
      <PageHeader title="Drivers" />
      <p className="mb-4 text-sm text-slate-500">
        Driver master. Each driver's assigned vehicle forms their operational unit; the scheduler enforces a
        mandatory 10-hour daily rest automatically.
        Expiry dates highlight in red when a document is within 30 days of expiring.
      </p>
      <DriverManager initial={(drivers as any[]) ?? []} vehicles={(vehicles as any[]) ?? []} vistaVehicles={(vistaVehicles as any[]) ?? []} />
    </div>
  );
}
