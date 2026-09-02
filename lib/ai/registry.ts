import type { AiTool, ToolContext, ToolResult } from "@/lib/ai/types";
import { ACCOUNTING_TOOLS } from "@/lib/ai/tools/accounting";
import { OPERATIONS_TOOLS } from "@/lib/ai/tools/operations";
import { WHATSAPP_TOOLS } from "@/lib/ai/tools/whatsapp";
import { staffCan, type StaffAccess } from "@/lib/staffSession";
import { logToolCall } from "@/lib/ai/audit";

// ============================================================
// The tool registry — the assistant's entire reach into the ERP.
//
// Two rules are enforced here rather than trusted to each tool:
//
//   1. A tool with no permission key is not registered. Not warned about,
//      not defaulted to admin — dropped, and reported to the server log. A
//      missing gate must fail closed.
//   2. A write tool is only offered to a user who holds BOTH ai.actions and
//      that tool's own module permission. ai.actions on its own grants
//      nothing; the module permission on its own grants nothing through the
//      assistant. Both, or neither.
//
// The permission is re-checked at execution time as well as at listing time.
// Listing decides what the model can see; execution decides what actually
// runs, and a model cannot talk its way past the second one.
// ============================================================

const ALL: AiTool[] = [...ACCOUNTING_TOOLS, ...OPERATIONS_TOOLS, ...WHATSAPP_TOOLS];

const REGISTERED: AiTool[] = ALL.filter((t) => {
  if (!t.perm) {
    console.error(`[vista-ai] tool "${t.name}" has no permission key — not registered.`);
    return false;
  }
  return true;
});

export function allTools(): AiTool[] {
  return REGISTERED;
}

export function toolsFor(access: StaffAccess): AiTool[] {
  return REGISTERED.filter((t) => canUse(access, t));
}

export function canUse(access: StaffAccess, tool: AiTool): boolean {
  if (!staffCan(access, "ai.use")) return false;
  if (tool.kind === "write" && !staffCan(access, "ai.actions")) return false;
  return staffCan(access, tool.perm);
}

export function findTool(name: string): AiTool | undefined {
  return REGISTERED.find((t) => t.name === name);
}

/** The tool list in the shape the Messages API wants. Stable order, so the prompt caches. */
export function toolSchemas(access: StaffAccess) {
  return toolsFor(access).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.schema as any,
  }));
}

/**
 * Run one tool call. This is the only path from a model decision to ERP data,
 * and it always: re-checks the permission, runs the tool, records the call,
 * and returns a truthful result — including when the tool failed.
 */
export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) {
    return { ok: false, error: `There is no such tool as "${name}".` };
  }
  if (!canUse(ctx.access, tool)) {
    const result: ToolResult = {
      ok: false,
      error: "You don't have permission for that, so I can't do it either.",
    };
    await logToolCall(ctx, name, tool.kind, args, result, { denied: true });
    return result;
  }

  let result: ToolResult;
  try {
    result = await tool.run(args ?? {}, ctx);
  } catch (e: any) {
    // A thrown tool is reported as a failure, never as an empty success — the
    // model must not be able to read silence as "nothing found".
    console.error(`[vista-ai] tool ${name} threw`, e);
    result = { ok: false, error: e?.message || "That lookup failed." };
  }

  await logToolCall(ctx, name, tool.kind, args, result);
  return result;
}
