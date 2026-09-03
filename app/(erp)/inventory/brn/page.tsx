import { createClient } from "@/lib/supabase/server";
import { guardStaffPage, getSessionUser } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { Brn, Consumption, dailyForBrn, totalNights, isArchived, sellableRun } from "@/lib/brn";
import BrnTable, { BrnRow } from "./BrnTable";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export const dynamic = "force-dynamic";

export default async function BrnListPage() {
  await guardStaffPage("brn.view");
  const supabase = createClient();
  const user = await getSessionUser();
  const [{ data: brns }, { data: cons }, { data: roles }] = await Promise.all([
    supabase.from("brn_inventory")
      .select("*, parties:supplier_id(name), group_companies:group_company_id(name)")
      .order("created_at", { ascending: false }),
    fetchAllRows<Consumption>((from, to) => supabase.from("brn_consumption").select("*").order("id").range(from, to)),
    supabase.from("user_roles").select("role").eq("user_id", user?.id ?? ""),
  ]);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

  const B = (brns ?? []) as (Brn & { parties: { name: string } | null; group_companies: { name: string } | null })[];
  const C = (cons ?? []) as Consumption[];
  const consByBrn: Record<string, Consumption[]> = {};
  C.forEach((c) => (consByBrn[c.brn_id] ||= []).push(c));

  // Active list = BRNs that still have beds available on at least one night.
  const rows: BrnRow[] = B
    .filter((b) => !isArchived(b, consByBrn[b.id] ?? []))
    .map((b) => {
      const own = consByBrn[b.id] ?? [];
      const daily = dailyForBrn(b, own);
      const minAvail = daily.reduce((m, d) => Math.min(m, d.available), b.beds);
      // The biggest block actually on offer, and WHICH nights it is. A single
      // number cannot say that, and read as though it could it makes beds that
      // are free before a group arrives look available to it.
      const run = sellableRun(b, own);
      return {
        id: b.id,
        created_at: (b as any).created_at,
        company: (b as any).group_companies?.name ?? "—",
        brn: b.brn,
        hotel_name: b.hotel_name,
        city: b.city ?? "—",
        supplier: (b as any).parties?.name ?? "—",
        check_in: b.check_in,
        check_out: b.check_out,
        nights: totalNights(b.check_in, b.check_out),
        beds: b.beds,
        available: run.beds,
        avail_nights: run.nights,
        avail_from: run.from,
        avail_to: run.to,
        status: minAvail < 0 ? "Overbooked" : minAvail === 0 ? "Tight" : "Available",
        consumed: own.length > 0,
      };
    });

  return (
    <div>
      <PageHeader title="BRN Inventory" action={{ href: "/inventory/brn/new", label: "Add BRN" }} />
      <p className="mb-4 text-sm text-slate-500">
        Active BRNs with beds still available. Fully consumed BRNs move to <b>Archived BRNs</b> automatically.
      </p>
      <BrnTable rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
