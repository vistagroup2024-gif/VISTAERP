import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { Brn, Consumption, dailyForBrn, totalNights, isArchived, maxNightlyAvailable } from "@/lib/brn";
import BrnTable, { BrnRow } from "./BrnTable";

export const dynamic = "force-dynamic";

export default async function BrnListPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data: brns }, { data: cons }, { data: roles }] = await Promise.all([
    supabase.from("brn_inventory")
      .select("*, parties:supplier_id(name), group_companies:group_company_id(name)")
      .order("check_in"),
    supabase.from("brn_consumption").select("*"),
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
      return {
        id: b.id,
        company: (b as any).group_companies?.name ?? "—",
        brn: b.brn,
        hotel_name: b.hotel_name,
        city: b.city ?? "—",
        supplier: (b as any).parties?.name ?? "—",
        check_in: b.check_in,
        check_out: b.check_out,
        nights: totalNights(b.check_in, b.check_out),
        beds: b.beds,
        available: maxNightlyAvailable(b, own),
        status: minAvail < 0 ? "Overbooked" : minAvail === 0 ? "Tight" : "Available",
        consumed: own.length > 0,
      };
    });

  return (
    <div>
      <PageHeader title="BRN Inventory" action={{ href: "/inventory/brn/new", label: "+ Add BRN" }} />
      <p className="mb-4 text-sm text-slate-500">
        Active BRNs with beds still available. Fully consumed BRNs move to <b>Archived BRNs</b> automatically.
      </p>
      <BrnTable rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
