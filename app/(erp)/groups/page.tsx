import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { dateStr } from "@/lib/format";
import GroupActions from "./GroupActions";

export const dynamic = "force-dynamic";

const PKG_BADGE: Record<string, { label: string; cls: string }> = {
  complete: { label: "Complete Package", cls: "bg-green-100 text-green-700" },
  update_required: { label: "Package Update Required", cls: "bg-orange-100 text-orange-700" },
  updated: { label: "Package Updated", cls: "bg-blue-100 text-blue-700" },
};

export default async function GroupsPage({ searchParams }: { searchParams: { company?: string } }) {
  const company = searchParams.company ?? "";
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let q = supabase
    .from("umrah_groups")
    .select("id, group_no, group_date, group_name, pax, arrival_date, departure_date, total_nights, brn_status, visa_status, package_status, parties:agent_id(name), group_companies:group_company_id(name)")
    .order("group_date", { ascending: false })
    .limit(500);
  if (company) q = q.eq("group_company_id", company);

  const [{ data: groups }, { data: roles }, { data: companies }] = await Promise.all([
    q,
    supabase.from("user_roles").select("role").eq("user_id", user?.id ?? ""),
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  const G = groups ?? [];

  function visaBadge(g: any) {
    if (g.visa_status === "issued") return <span className="badge bg-emerald-600 text-white">Visa Issued</span>;
    if (g.brn_status === "allocated") return <span className="badge bg-green-100 text-green-700">BRN Allocated</span>;
    return <span className="badge bg-yellow-100 text-yellow-800">Pending</span>;
  }

  return (
    <div>
      <PageHeader title="Visa Groups" action={{ href: "/groups/new", label: "+ New Group" }} />
      <CompanyFilter companies={companies ?? []} value={company} />
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1080px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Date</th>
              <th className="th">Group No</th>
              <th className="th">Company</th>
              <th className="th">Name</th>
              <th className="th">Agent</th>
              <th className="th">Pax</th>
              <th className="th">Arrival</th>
              <th className="th">Departure</th>
              <th className="th">Nights</th>
              <th className="th">Visa Status</th>
              <th className="th">Package</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {G.map((g: any) => (
              <tr key={g.id} className="border-t border-slate-100">
                <td className="td text-sm">{dateStr(g.group_date)}</td>
                <td className="td font-mono font-medium">
                  <Link href={`/groups/${g.id}`} className="text-brand hover:underline">{g.group_no}</Link>
                </td>
                <td className="td text-slate-500">{g.group_companies?.name ?? "—"}</td>
                <td className="td">{g.group_name ?? "—"}</td>
                <td className="td text-slate-500">{g.parties?.name ?? "—"}</td>
                <td className="td font-medium">{g.pax}</td>
                <td className="td text-sm">{dateStr(g.arrival_date)}</td>
                <td className="td text-sm">{dateStr(g.departure_date)}</td>
                <td className="td">{g.total_nights}</td>
                <td className="td">{visaBadge(g)}</td>
                <td className="td">
                  {g.package_status
                    ? <span className={`badge ${PKG_BADGE[g.package_status]?.cls ?? "bg-slate-100 text-slate-600"}`}>{PKG_BADGE[g.package_status]?.label ?? g.package_status}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="td">
                  <GroupActions groupId={g.id} brnStatus={g.brn_status} visaStatus={g.visa_status} isAdmin={isAdmin} />
                </td>
              </tr>
            ))}
            {G.length === 0 && (
              <tr><td className="td text-slate-400" colSpan={12}>No groups yet. Click “New Group” to start.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
