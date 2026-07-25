import { redirect } from "next/navigation";
import Link from "next/link";
import { getAgent } from "@/lib/agentSession";
import { PERMISSION_CATALOG } from "@/lib/permissions";
import AgentLogout from "./AgentLogout";

export const dynamic = "force-dynamic";

// Nav is built dynamically from the agent's granted permissions. A module shows
// only if the agent holds at least one permission within it.
const NAV: { module: string; label: string; href: string }[] = [
  { module: "Dashboard", label: "Dashboard", href: "/agent" },
  { module: "Visa Module", label: "My Visa Groups", href: "/agent/groups" },
  { module: "Hotels", label: "Hotels", href: "/agent/module/hotels" },
  { module: "Transportation", label: "Transport", href: "/agent/module/transport" },
  { module: "Flights", label: "Flights", href: "/agent/module/flights" },
  { module: "Reports", label: "Reports", href: "/agent/module/reports" },
  { module: "Financial", label: "Financial", href: "/agent/module/financial" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");

  const hasModule = (moduleName: string) => {
    const grp = PERMISSION_CATALOG.find((g) => g.module === moduleName);
    return !!grp && grp.perms.some((p) => agent.permissions?.[p.key]);
  };

  const nav = NAV.filter((n) => hasModule(n.module));
  nav.push({ module: "Profile", label: "Profile", href: "/agent/profile" });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-bold text-brand-dark">Vista B2B</span>
          <nav className="flex flex-wrap gap-4 text-sm">
            {nav.map((n) => <Link key={n.href} href={n.href} className="text-slate-600 hover:text-brand">{n.label}</Link>)}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">{agent.agency_name}</span>
          <AgentLogout />
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}
