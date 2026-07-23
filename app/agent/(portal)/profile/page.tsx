import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import ChangePassword from "./ChangePassword";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-xs uppercase tracking-wide text-slate-400">{label}</p><p className="font-medium">{value ?? "—"}</p></div>;
}

export default async function AgentProfile() {
  const agent = await getAgent();
  if (!agent) redirect("/agent/login");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">My Profile</h1>
      <div className="grid grid-cols-2 gap-4 rounded-xl bg-white p-5 shadow-sm md:grid-cols-3">
        <Row label="Agency" value={agent.agency_name} />
        <Row label="Email" value={agent.email} />
        <Row label="Mobile" value={agent.mobile} />
        <Row label="Currency" value={agent.currency} />
      </div>
      {can(agent, "profile.password") || true ? <ChangePassword token={agent.token} /> : null}
    </div>
  );
}
