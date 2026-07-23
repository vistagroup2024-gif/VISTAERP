import { redirect } from "next/navigation";
import Link from "next/link";
import { getAgent, can } from "@/lib/agentSession";
import AgentLogout from "./AgentLogout";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const agent = await getAgent();
  if (!agent) redirect("/agent/login");

  const nav = [
    { href: "/agent", label: "Dashboard", show: can(agent, "dashboard.view") || true },
    { href: "/agent/groups", label: "My Visa Groups", show: can(agent, "visa.view_own") },
    { href: "/agent/profile", label: "Profile", show: true },
  ].filter((n) => n.show);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-bold text-brand-dark">Vista B2B</span>
          <nav className="flex gap-4 text-sm">
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
