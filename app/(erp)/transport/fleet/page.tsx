import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import FleetDocs from "./FleetDocs";

export const dynamic = "force-dynamic";

function Alert({ label, date }: { label: string; date: string | null }) {
  if (!date) return null;
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86400000);
  const overdue = days < 0;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
      {label}: {date} {overdue ? `(${-days}d overdue)` : `(${days}d)`}
    </span>
  );
}

export default async function FleetPage() {
  const sb = createClient();
  const [{ data: alerts }, { data: vehicles }] = await Promise.all([
    sb.rpc("transport_fleet_alerts"),
    sb.from("transport_vehicles").select("id, name, insurance_expiry, registration_expiry, next_service_date, odometer_km").order("name"),
  ]);
  const a: any = alerts ?? {};
  const vAlerts: any[] = a.vehicles ?? [];
  const dAlerts: any[] = a.drivers ?? [];

  return (
    <div className="max-w-5xl">
      <PageHeader title="Fleet Health" />
      <p className="mb-4 text-sm text-slate-500">Insurance, registration (Istimara), and service reminders. Items due within 30 days or overdue appear here.</p>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-semibold text-slate-700">🚗 Vehicle alerts</h2>
          {vAlerts.length === 0 ? <p className="text-sm text-slate-400">All vehicle documents are current.</p> : (
            <ul className="space-y-2">{vAlerts.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2 last:border-0">
                <span className="font-medium text-slate-700">{v.name}</span>
                <Alert label="Insurance" date={v.insurance_expiry} />
                <Alert label="Registration" date={v.registration_expiry} />
                <Alert label="Service" date={v.next_service_date} />
              </li>))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold text-slate-700">🧑‍✈️ Driver document alerts</h2>
          {dAlerts.length === 0 ? <p className="text-sm text-slate-400">All driver documents are current.</p> : (
            <ul className="space-y-2">{dAlerts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-2 last:border-0">
                <span className="font-medium text-slate-700">{d.name}</span>
                <Alert label="Iqama" date={d.iqama_expiry} />
                <Alert label="License" date={d.license_expiry} />
              </li>))}
            </ul>
          )}
        </div>
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Vehicle Documents & Maintenance</h2>
      <FleetDocs initial={(vehicles as any[]) ?? []} />
    </div>
  );
}
