import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { getStaffAccess, staffCan } from "@/lib/staffSession";
import DeleteButton from "@/components/DeleteButton";

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

  const access = await getStaffAccess();
  if (!staffCan(access, "users.view")) {
    return <div className="card text-slate-500">You don’t have permission to view users.</div>;
  }
  const canCreate = staffCan(access, "users.create");
  const canDelete = staffCan(access, "users.delete");

  const { data: users } = await supabase.rpc("staff_users_list");

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
      <PageHeader title="Staff Users" action={canCreate ? { href: "/settings/users/new", label: "New User" } : undefined} />
      <p className="mb-4 text-sm text-slate-500">
        Manage staff accounts and permission roles. Login ID is the username — no email needed.
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Full Name</th>
              <th className="th">Login ID</th>
              <th className="th">Department</th>
              <th className="th">Roles</th>
              <th className="th">Status</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u: any) => {
              const roles = rolesByUser[u.id] ?? [];
              return (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="td font-medium">{u.full_name ?? "—"}</td>
                  <td className="td">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-sm text-slate-700">
                      {u.username}
                    </span>
                  </td>
                  <td className="td">
                    {u.department ?? "—"}
                    {u.designation && <div className="text-xs text-slate-400">{u.designation}</div>}
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
                    {u.is_active
                      ? <span className="badge bg-green-100 text-green-700">Active</span>
                      : <span className="badge bg-slate-100 text-slate-500">Inactive</span>}
                  </td>
                  <td className="td text-right">
                    <span className="inline-flex items-center gap-3">
                      <Link href={`/settings/users/${u.id}`} className="text-brand text-sm hover:underline">
                        Edit
                      </Link>
                      {canDelete && (
                        <DeleteButton rpc="delete_staff_user" paramName="p_id" id={u.id}
                          confirmText={`Delete user "${u.full_name ?? u.username}"? This permanently removes their account and cannot be undone.`} />
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
            {(users ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No users found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
