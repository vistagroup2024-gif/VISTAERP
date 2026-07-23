import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface AgentSession {
  token: string;
  id: string;
  agency_name: string;
  agent_party_id: string | null;
  email: string | null;
  mobile: string | null;
  currency: string | null;
  credit_limit: number | null;
  permissions: Record<string, boolean>;
}

// Reads the b2b_session cookie and resolves it to the agent profile (or null).
export async function getAgent(): Promise<AgentSession | null> {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return null;
  const supabase = createClient();
  const { data } = await supabase.rpc("b2b_me", { p_token: token });
  if (!data) return null;
  return { ...(data as any), token };
}

export function can(agent: AgentSession | null, key: string): boolean {
  return !!agent?.permissions?.[key];
}

// Agents only ever see three simple states — internal Vista stages are hidden.
export function agentStatus(workflow_status?: string, visa_status?: string): "Pending" | "Under Process" | "Visa Issued" {
  if (visa_status === "issued" || workflow_status === "visa_issued") return "Visa Issued";
  if (!workflow_status || workflow_status === "pending") return "Pending";
  return "Under Process";
}
