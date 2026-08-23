import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface AgentSession {
  token: string;
  id: string;
  agency_name: string;
  agent_party_id: string | null;
  email: string | null;
  mobile: string | null;
  logo: string | null;
  currency: string | null;
  credit_limit: number | null;
  permissions: Record<string, boolean>;
  // Acting user (multi-user portal). Owner = the agency's max-access account.
  user_id: string | null;
  full_name: string | null;
  username: string | null;
  is_owner: boolean;
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

// Agents see a simplified set of statuses — internal Vista stages (Process, BRN
// Allocated, ERP Created) are hidden and collapsed to "Under Processing".
export type AgentStatus =
  | "Pending" | "Payment Required" | "Under Processing" | "Package Assigned" | "Visa Issued" | "Rejected";

export function agentStatus(workflow_status?: string, visa_status?: string): AgentStatus {
  if (visa_status === "issued" || workflow_status === "visa_issued") return "Visa Issued";
  if (workflow_status === "rejected") return "Rejected";
  if (workflow_status === "payment_pending") return "Payment Required";
  if (workflow_status === "package_assigned") return "Package Assigned";
  if (!workflow_status || workflow_status === "pending") return "Pending";
  return "Under Processing"; // process, brn_allocated, erp_created
}
