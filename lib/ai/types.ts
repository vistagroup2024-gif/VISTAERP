import type { SupabaseClient } from "@supabase/supabase-js";
import type { StaffAccess } from "@/lib/staffSession";

// ============================================================
// The contract every Vista AI tool obeys.
//
// A tool is the ONLY way the assistant reaches the ERP. It never queries the
// database on its own terms: it picks a tool, the tool checks the caller's
// permission, and the tool calls the same RPC the corresponding screen calls.
// That is what keeps "the AI cannot do what the user cannot do" true by
// construction rather than by good intentions.
// ============================================================

export interface ToolContext {
  /** Server Supabase client carrying the CALLER'S session. Never a service key. */
  sb: SupabaseClient<any, any, any>;
  companyId: string;
  userId: string;
  access: StaffAccess;
  /** The ERP page the user is looking at, when they are on one. */
  page?: PageContext | null;
}

export interface PageContext {
  route: string;
  entityType?: string | null;
  entityId?: string | null;
}

export interface ToolResult {
  ok: boolean;
  /** Whatever the model should see. Kept small — see `trim` in the tools. */
  data?: unknown;
  error?: string;
  /** Row count, for the audit line and the activity feed. */
  count?: number;
  /** One short line describing what happened, shown in the Activity tab. */
  summary?: string;
  /** A screen the user can open to see this for themselves. */
  link?: string;
}

export interface AiTool {
  name: string;
  description: string;
  /** read = no confirmation. write = preview, then an explicit second call. */
  kind: "read" | "write";
  /**
   * The staff permission key this tool needs. REQUIRED — a tool with no
   * permission cannot be registered (see registry.ts). Reusing the existing
   * module keys is deliberate: the AI inherits the module gates already in
   * force, so nothing new has to be kept in sync.
   */
  perm: string;
  /** JSON Schema for the arguments. */
  schema: Record<string, unknown>;
  run(args: any, ctx: ToolContext): Promise<ToolResult>;
}
