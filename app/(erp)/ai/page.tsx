import PageHeader from "@/components/PageHeader";
import VistaAI from "./VistaAI";
import { guardStaffPage } from "@/lib/staffSession";
import { aiConfigured } from "@/lib/ai/config";

export const dynamic = "force-dynamic";

export default async function VistaAiPage() {
  // Same gate as every other screen: hidden in the nav AND unreachable by URL.
  await guardStaffPage("ai.use");

  // Whether the key exists — never the key. The browser is told "configured"
  // or "not configured" and nothing else.
  return (
    <div className="space-y-4">
      <PageHeader title="Vista AI" subtitle="Ask about the ERP in your own words" hideBack />
      <VistaAI configured={aiConfigured()} />
    </div>
  );
}
