import { redirect } from "next/navigation";
import { getAgent } from "@/lib/agentSession";
import NotificationSettings from "@/components/NotificationSettings";

export const dynamic = "force-dynamic";

export default async function AgentNotificationsPage() {
  const agent = await getAgent();
  if (!agent) redirect("/login");
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Notifications</h1>
      <p className="text-sm text-slate-500">Turn on phone notifications to get alerts about your bookings even when the portal is closed.</p>
      <NotificationSettings endpoint="/api/agent/push" />
    </div>
  );
}
