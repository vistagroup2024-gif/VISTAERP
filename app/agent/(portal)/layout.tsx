import { redirect } from "next/navigation";
import { getAgent } from "@/lib/agentSession";
import { PERMISSION_CATALOG } from "@/lib/permissions";
import AgentSidebar, { AgentNavItem } from "@/components/AgentSidebar";
import NotificationBell from "@/components/NotificationBell";

export const dynamic = "force-dynamic";

// Nav is built from the agent's granted permissions — a module appears only if
// the agent holds at least one permission within it. Same interface as admin.
const NAV: { module: string; label: string; href: string; icon: string }[] = [
  { module: "Dashboard", label: "Dashboard", href: "/agent", icon: "▣" },
  { module: "Visa Module", label: "My Visa Groups", href: "/agent/groups", icon: "🕋" },
  { module: "Hotels", label: "Hotels", href: "/agent/module/hotels", icon: "🏨" },
  { module: "Transportation", label: "Transport", href: "/agent/module/transport", icon: "🚌" },
  { module: "Flights", label: "Flights", href: "/agent/module/flights", icon: "✈️" },
  { module: "Reports", label: "Reports", href: "/agent/module/reports", icon: "📊" },
  { module: "Financial", label: "Financial", href: "/agent/module/financial", icon: "💳" },
];

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const agent = await getAgent();
  if (!agent) redirect("/login");

  const hasModule = (moduleName: string) => {
    const grp = PERMISSION_CATALOG.find((g) => g.module === moduleName);
    return !!grp && grp.perms.some((p) => agent.permissions?.[p.key]);
  };

  const nav: AgentNavItem[] = NAV.filter((n) => hasModule(n.module)).map(({ label, href, icon }) => ({ label, href, icon }));
  nav.push({ label: "Profile", href: "/agent/profile", icon: "👤" });

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AgentSidebar agencyName={agent.agency_name} nav={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop top bar with notifications (mobile bell lives in the sidebar bar) */}
        <header className="hidden items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-2 lg:flex">
          <NotificationBell endpoint="/api/agent/notifications" groupBase="/agent/groups" />
          <span className="text-sm text-slate-500">{agent.agency_name}</span>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 pt-18 lg:p-8 lg:pt-6">{children}</main>
      </div>
    </div>
  );
}
