import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import BookingsTable from "./BookingsTable";

export const dynamic = "force-dynamic";

export default async function BookingsPage({ searchParams }: { searchParams: { created?: string } }) {
  const sb = createClient();
  const { data: rows } = await sb
    .from("transport_bookings")
    .select("id, booking_no, booking_type, status, passenger_name, mobile, pax, booking_date, total_amount, currency, group_company_id, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const companyIds = Array.from(new Set((rows ?? []).map((r: any) => r.group_company_id).filter(Boolean)));
  const { data: companies } = companyIds.length
    ? await sb.from("group_companies").select("id, name").in("id", companyIds)
    : { data: [] as any[] };
  const cName = new Map((companies ?? []).map((c: any) => [c.id, c.name]));
  const enriched = (rows ?? []).map((r: any) => ({ ...r, company_name: r.group_company_id ? cName.get(r.group_company_id) ?? null : null }));

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
