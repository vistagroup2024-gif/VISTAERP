import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import GroupsTable, { GroupRow } from "./GroupsTable";

export const dynamic = "force-dynamic";

const PKG_LABEL: Record<string, string> = {
  complete: "Complete Package",
  update_required: "Package Update Required",
  update_available: "Ready for Package Update",
  update_ready: "Package Ready for Nusuk Update",
  updated: "Package Updated",
};

const WF_LABEL: Record<string, string> = {
  pending: "Pending",
  brn_allocated: "BRN Allocated",
  erp_created: "ERP Created",
  package_assigned: "Package Assigned",
  visa_issued: "Visa Issued",
};

export default async function GroupsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: groups }, { data: roles }] = await Promise.all([
    supabase
      .from("umrah_groups")
      .select("id, group_no, group_date, group_name, pax, arrival_date, departure_date, total_nights, brn_status, visa_status, workflow_status, package_status, agent_brn_pending, visa_type, parties:agent_id(name), group_companies:group_company_id(name)")
      .order("group_date", { ascending: false })
      .limit(1000),
    supabase.from("user_roles").select("role").eq("user_id", user?.id ?? ""),
  ]);

  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

  const rows: GroupRow[] = (groups ?? []).map((g: any) => ({
    id: g.id,
    group_no: g.group_no,
    group_date: g.group_date,
    group_name: g.group_name ?? "",
    company: g.group_companies?.name ?? "",
    agent: g.parties?.name ?? "",
    pax: g.pax,
    arrival_date: g.arrival_date,
    departure_date: g.departure_date,
    total_nights: g.total_nights,
    brn_status: g.brn_status,
    visa_status: g.visa_status,
    workflow_status: g.workflow_status ?? (g.visa_status === "issued" ? "visa_issued" : g.brn_status === "allocated" ? "brn_allocated" : "pending"),
    agent_brn_pending: !!g.agent_brn_pending,
    package_status: g.package_status,
    visa_label: WF_LABEL[g.workflow_status ?? (g.visa_status === "issued" ? "visa_issued" : g.brn_status === "allocated" ? "brn_allocated" : "pending")] ?? "Pending",
    package_label: g.package_status ? (PKG_LABEL[g.package_status] ?? g.package_status) : "",
  }));

  return (
    <div>
      <PageHeader title="Visa Groups" action={{ href: "/groups/new", label: "+ New Group" }} />
      <GroupsTable rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
