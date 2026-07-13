import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { dateStr } from "@/lib/format";
import GroupAllocation from "./GroupAllocation";
import GroupHeaderActions from "./GroupHeaderActions";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-medium">{value ?? "—"}</p>
    </div>
  );
}

export default async function GroupDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: g } = await supabase
    .from("umrah_groups")
    .select("*, agent:agent_id(name), company:ref_company_id(name), af:arrival_from(city,code), aa:arrival_airport(city,code), dt:departure_to(city,code), da:departure_airport(city,code)")
    .eq("id", params.id)
    .single();
  if (!g) notFound();

  const { data: allocations } = await supabase
    .from("group_brn_allocation")
    .select("id, beds, brn_inventory:brn_id(id, brn, hotel_name, city, beds), brn_consumption:consumption_id(check_in, check_out)")
    .eq("group_id", params.id);

  const A = (allocations ?? []) as any[];

  // Is the current user an admin? (controls reopen)
  const { data: { user } } = await supabase.auth.getUser();
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user?.id ?? "");
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono">{g.group_no}</h1>
          <p className="text-slate-500">{g.group_name ?? "Umrah Group"} · {g.pax} pax · {g.total_nights} nights</p>
        </div>
        <GroupHeaderActions groupId={g.id} brnStatus={g.brn_status} visaStatus={g.visa_status} isAdmin={isAdmin} />
      </div>

      <div className="card grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field label="Date" value={dateStr(g.group_date)} />
        <Field label="Agent" value={(g as any).agent?.name} />
        <Field label="Company" value={(g as any).company?.name} />
        <Field label="Pax" value={g.pax} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">✈️ Arrival</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" value={dateStr(g.arrival_date)} />
            <Field label="Flight" value={g.arrival_flight} />
            <Field label="From" value={(g as any).af ? `${(g as any).af.city} (${(g as any).af.code})` : g.arrival_from} />
            <Field label="Airport" value={(g as any).aa ? `${(g as any).aa.city} (${(g as any).aa.code})` : g.arrival_airport} />
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-700">✈️ Departure</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" value={dateStr(g.departure_date)} />
            <Field label="Flight" value={g.departure_flight} />
            <Field label="To" value={(g as any).dt ? `${(g as any).dt.city} (${(g as any).dt.code})` : g.departure_to} />
            <Field label="Airport" value={(g as any).da ? `${(g as any).da.city} (${(g as any).da.code})` : g.departure_airport} />
          </div>
        </div>
      </div>

      <GroupAllocation
        groupId={g.id}
        pax={g.pax}
        brnStatus={g.brn_status}
        visaStatus={g.visa_status}
        visaIssuedAt={g.visa_issued_at}
        isAdmin={isAdmin}
        allocations={A}
      />
    </div>
  );
}
