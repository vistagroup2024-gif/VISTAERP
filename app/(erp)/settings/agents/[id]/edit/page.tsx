import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import AgentForm from "../../AgentForm";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const [{ data: agent }, { data: parties }, { data: users }] = await Promise.all([
    supabase.from("b2b_agents").select("*").eq("id", params.id).single(),
    supabase.from("parties").select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name"),
    supabase.rpc("agency_users", { p_agent: params.id }),
  ]);
  if (!agent) notFound();
  const userRows: any[] = (users as any[]) ?? [];
  return (
    <div className="space-y-6">
      <AgentForm parties={parties ?? []} existing={agent} />
      <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 font-semibold text-slate-800">Portal Users ({userRows.length})</h2>
        <p className="mb-3 text-xs text-slate-500">The Owner is created from the login above. Staff sub-users are created by the agency Owner — shown here for visibility.</p>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr>
            <th className="th">Name</th><th className="th">Username</th><th className="th">Role</th><th className="th">Status</th><th className="th">Access</th>
          </tr></thead>
          <tbody>
            {userRows.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 align-top">
                <td className="td font-medium">{u.full_name}</td>
                <td className="td font-mono text-xs">{u.username}</td>
                <td className="td">{u.is_owner ? "Owner" : "Staff"}</td>
                <td className="td">{u.status}</td>
                <td className="td text-xs text-slate-500">{Object.entries(u.permissions ?? {}).filter(([, v]) => v).map(([k]) => k).length} permission(s)</td>
              </tr>
            ))}
            {userRows.length === 0 && <tr><td className="td text-slate-400" colSpan={5}>No users yet — save a username &amp; password above to create the Owner.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
