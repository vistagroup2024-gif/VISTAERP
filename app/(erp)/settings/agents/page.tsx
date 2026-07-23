import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";
import { ALL_PERM_KEYS } from "@/lib/permissions";
import AgentActions from "./AgentActions";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("b2b_agents")
    .select("*")
    .order("agency_name");

  const A = rows ?? [];

  return (
    <div>
      <PageHeader title="B2B Agent Users" action={{ href: "/settings/agents/new", label: "+ New Agent" }} />
      <p className="mb-4 text-sm text-slate-500">
        Partner travel-agent accounts with configurable, module-level permissions (RBAC). Each agent only accesses the modules you enable.
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[980px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Agency</th>
              <th className="th">Contact</th>
              <th className="th">Username</th>
              <th className="th">Country</th>
              <th className="th">Credit Limit</th>
              <th className="th">Login</th>
              <th className="th">Permissions</th>
              <th className="th">Status</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {A.map((a: any) => {
              const granted = ALL_PERM_KEYS.filter((k) => a.permissions?.[k]).length;
              return (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="td font-medium">{a.agency_name}</td>
                  <td className="td text-slate-500">{a.contact_person ?? "—"}</td>
                  <td className="td font-mono">{a.username}</td>
                  <td className="td">{a.country ?? "—"}</td>
                  <td className="td">{a.credit_limit ? money(a.credit_limit, a.currency ?? "SAR") : "—"}</td>
                  <td className="td">{a.password_hash ? <span className="badge bg-green-100 text-green-700">Set</span> : <span className="badge bg-slate-100 text-slate-500">No password</span>}</td>
                  <td className="td text-slate-500">{granted}/{ALL_PERM_KEYS.length}</td>
                  <td className="td">
                    {a.locked
                      ? <span className="badge bg-red-100 text-red-700">Locked</span>
                      : a.status === "active"
                      ? <span className="badge bg-green-100 text-green-700">Active</span>
                      : <span className="badge bg-slate-100 text-slate-500">Inactive</span>}
                  </td>
                  <td className="td"><AgentActions id={a.id} status={a.status} locked={a.locked} /></td>
                </tr>
              );
            })}
            {A.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No B2B agents yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
