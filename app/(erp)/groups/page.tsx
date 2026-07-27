import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyInquiryButton from "@/components/CompanyInquiryButton";
import RealtimeRefresh from "@/components/RealtimeRefresh";
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
  process: "Process",
  payment_pending: "Payment Pending",
  rejected: "Rejected",
  brn_allocated: "BRN Allocated",
  erp_created: "ERP Created",
  package_assigned: "Package Assigned",
  visa_issued: "Visa Issued",
};

export default async function GroupsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: groups }, { data: roles }, { data: availMap }] = await Promise.all([
    supabase
      .from("umrah_groups")
      .select("id, created_at, group_no, group_date, group_name, pax, arrival_date, departure_date, total_nights, brn_status, visa_status, workflow_status, package_status, agent_brn_pending, visa_type, parties:agent_id(name), group_companies:group_company_id(name)")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("user_roles").select("role").eq("user_id", user?.id ?? ""),
    supabase.rpc("brn_availability_map"),
  ]);

  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  const avail = (availMap as Record<string, string>) ?? {};
  // Once a group is in "Process", show its BRN readiness instead of the generic stage.
  const AVAIL_LABEL: Record<string, string> = {
    complete: "Ready to Allocate", partial: "Ready to Allocate (partial)", none: "Waiting BRN",
  };
  const labelFor = (g: any, wf: string) =>
    wf === "process" ? (AVAIL_LABEL[avail[g.id]] ?? "Process") : (WF_LABEL[wf] ?? "Pending");

  const rows: GroupRow[] = (groups ?? []).map((g: any) => ({
    id: g.id,
    created_at: g.created_at,
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
    visa_type: g.visa_type ?? "normal",
    agent_brn_pending: !!g.agent_brn_pending,
    package_status: g.package_status,
    visa_label: labelFor(g, g.workflow_status ?? (g.visa_status === "issued" ? "visa_issued" : g.brn_status === "allocated" ? "brn_allocated" : "pending")),
    package_label: g.package_status ? (PKG_LABEL[g.package_status] ?? g.package_status) : "",
  }));

  return (
    <div>
      <RealtimeRefresh tables={["umrah_groups", "group_brn_allocation"]} />
      <PageHeader title="Visa Groups" action={{ href: "/groups/new", label: "+ New Group" }}>
        <CompanyInquiryButton endpoint="/api/recommendation" canRelease />
      </PageHeader>
      <GroupsTable rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
