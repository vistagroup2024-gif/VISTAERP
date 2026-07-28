import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import BookingsTable from "./BookingsTable";

export const dynamic = "force-dynamic";

export default async function BookingsPage({ searchParams }: { searchParams: { created?: string } }) {
  const sb = createClient();
  const { data: rows } = await sb
    .from("transport_bookings")
    .select("id, booking_no, booking_type, status, passenger_name, mobile, pax, booking_date, total_amount, currency, agent_id, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const agentIds = Array.from(new Set((rows ?? []).map((r: any) => r.agent_id).filter(Boolean)));
  const { data: agents } = agentIds.length
    ? await sb.from("b2b_agents").select("id, agency_name").in("id", agentIds)
    : { data: [] as any[] };
  const aName = new Map((agents ?? []).map((a: any) => [a.id, a.agency_name]));
  const enriched = (rows ?? []).map((r: any) => ({ ...r, agent_name: r.agent_id ? aName.get(r.agent_id) ?? null : "Direct" }));

  return (
    <div className="max-w-6xl">
      <PageHeader title="Transport Bookings" action={{ href: "/transport/bookings/new", label: "+ New Booking" }} />
      {searchParams.created && (
        <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">✓ Booking created successfully.</div>
      )}
      <BookingsTable initial={enriched} />
    </div>
  );
}
