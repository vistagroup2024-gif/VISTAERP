import { redirect } from "next/navigation";
import { getAgent } from "@/lib/agentSession";
import { PERMISSION_CATALOG } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const SLUG_MODULE: Record<string, string> = {
  hotels: "Hotels",
  transport: "Transportation",
  flights: "Flights",
  reports: "Reports",
  financial: "Financial",
};

export default async function AgentModulePage({ params }: { params: { key: string } }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");

  const moduleName = SLUG_MODULE[params.key];
  const grp = moduleName ? PERMISSION_CATALOG.find((g) => g.module === moduleName) : undefined;
  const allowed = !!grp && grp.perms.some((p) => agent.permissions?.[p.key]);

  // URL-level enforcement — access is denied even if the menu is hidden.
  if (!allowed) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have access to this module.</div>;
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold text-slate-800">{moduleName}</h1>
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <p className="text-slate-600">The <b>{moduleName}</b> module is enabled for your account.</p>
        <p className="mt-1 text-sm text-slate-400">Booking features for this module are coming soon.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {grp!.perms.filter((p) => agent.permissions?.[p.key]).map((p) => (
            <span key={p.key} className="rounded-full bg-brand/10 px-3 py-1 text-xs text-brand-dark">{p.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
