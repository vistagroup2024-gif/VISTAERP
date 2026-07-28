import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { STAFF_PERMISSION_CATALOG } from "@/lib/staffPermissions";

export const dynamic = "force-dynamic";

export default function RolesPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="Roles & Permissions" />
      <div className="card mb-5 space-y-3 text-sm text-slate-600">
        <p>
          Vista ERP uses one unified permission engine for staff and B2B agents. Permissions are assigned
          <b> per user</b> — open a staff user to grant or deny each module and action, or an agent to manage their B2B access.
        </p>
        <p className="text-xs text-slate-400">
          A user with no permissions ticked has full access; ticking any box switches them to restricted access
          (they then see only the modules you allow). Menu visibility and the User Management pages are enforced by these permissions.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/users" className="btn">Staff Users</Link>
          <Link href="/settings/agents" className="btn-outline">B2B Agents</Link>
        </div>
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Staff Permission Catalog</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {STAFF_PERMISSION_CATALOG.map((g) => (
          <div key={g.module} className="card">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">{g.module}</h3>
            <ul className="space-y-1 text-sm text-slate-500">
              {g.perms.map((p) => <li key={p.key}>• {p.label}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
