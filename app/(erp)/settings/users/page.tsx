import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  accounting: "Accountant",
  sales: "Sales",
  purchase: "Purchase",
  hr: "HR",
  inventory: "Inventory",
  hotel_ops: "Hotel Ops",
  b2b_agent: "B2B Agent",
};

const ROLE_COLOR: Record<string, string> = {
  admin: "bg-red-100 text-red-700",
  accounting: "bg-blue-100 text-blue-700",
  sales: "bg-green-100 text-green-700",
  purchase: "bg-orange-100 text-orange-700",
  hr: "bg-purple-100 text-purple-700",
  inventory: "bg-yellow-100 text-yellow-700",
  hotel_ops: "bg-cyan-100 text-cyan-700",
  b2b_agent: "bg-slate-100 text-slate-600",
};

export default async function UsersPage() {
  const supabase = createClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, is_active, created_at")
    .order("created_at");

  const { data: allRoles } = await supabase
    .from("user_roles")
    .select("user_id, role");

  const rolesByUser: Record<string, string[]> = {};
  (allRoles ?? []).forEach((r: any) => {
    if (!rolesByUser[r.user_id]) rolesByUser[r.user_id] = [];
    rolesByUser[r.user_id].push(r.role);
  });

  return (
    <div>
      <PageHeader title="Users & Roles" action={{ href: "/settings/users/new", label: "+ New User" }} />
      <p className="mb-4 text-sm text-slate-500">
        Manage staff accounts and their permission roles. Only admins can create or edit users.
      </p>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Username (login)</th>
              <th className="th">Roles</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p: any) => {
              const roles = rolesByUser[p.id] ?? [];
              return (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="td font-medium">{p.full_name ?? "—"}</td>
                  <td className="td font-mono text-sm text-slate-500">
                    {/* email stored as username@vista.local */}
                    —
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      {roles.length === 0 && <span className="text-slate-400 text-sm">No roles</span>}
                      {roles.map((r) => (
                        <span key={r} className={`badge ${ROLE_COLOR[r] ?? "bg-slate-100 text-slate-600"}`}>
                          {ROLE_LABEL[r] ?? r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="td">
                    {p.is_active
                      ? <span className="badge bg-green-100 text-green-700">Active</span>
                      : <span className="badge bg-slate-100 text-slate-500">Inactive</span>}
                  </td>
                  <td className="td text-right">
                    <Link href={`/settings/users/${p.id}`} className="text-brand text-sm hover:underline">
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
            {(profiles ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={5}>No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
