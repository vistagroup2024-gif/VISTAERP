import Link from "next/link";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function RolesPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="Roles & Permissions" />
      <div className="card space-y-3 text-sm text-slate-600">
        <p>
          Permissions are assigned <b>per user</b>. Open a staff user to grant or deny access to each module
          and action, or an agent to manage their B2B permissions.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/users" className="btn">Staff Users</Link>
          <Link href="/settings/agents" className="btn-outline">B2B Agents</Link>
        </div>
        <p className="text-xs text-slate-400">
          Granular per-user staff permissions (unified with the B2B agent engine) are being rolled out.
        </p>
      </div>
    </div>
  );
}
