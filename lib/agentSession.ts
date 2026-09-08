import { cache } from "react";
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
//
// Wrapped in React cache() for the same reason getStaffAccess is: the portal
// layout and the page inside it both ask, so an agent's every screen was paying
// for b2b_me TWICE. cache() is scoped to a single server request, so the two
// calls in one render share an answer and two agents browsing at the same time
// still each get their own — the memo cannot outlive the request that made it.
//
// Safe here because the session cannot change underneath a request that reads
// it: nothing calls getAgent() and then changes the cookie, and the only routes
// that set or clear b2b_session (agent login and logout) read the cookie
// directly and never call this at all.
export const getAgent = cache(async function getAgent(): Promise<AgentSession | null> {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return null;
  const supabase = createClient();
  const { data } = await supabase.rpc("b2b_me", { p_token: token });
  if (!data) return null;
  return { ...(data as any), token };
});

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
