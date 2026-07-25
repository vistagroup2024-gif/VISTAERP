import { redirect } from "next/navigation";
import { getAgent, can } from "@/lib/agentSession";
import CompanyRecommendation from "@/components/CompanyRecommendation";

export const dynamic = "force-dynamic";

export default async function AgentRecommendationPage() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  if (!can(agent, "visa.recommend")) {
    return <div className="rounded-xl bg-white p-6 text-slate-500 shadow-sm">You don’t have permission to use the Company Recommendation tool.</div>;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-800">Company Recommendation</h1>
      <p className="text-sm text-slate-500">
        Before creating a group in Nusuk Masar, check which company to select based on current BRN availability. Reserve a company to hold it while you create the group.
      </p>
      <CompanyRecommendation endpoint="/api/agent/recommendation" />
    </div>
  );
}
