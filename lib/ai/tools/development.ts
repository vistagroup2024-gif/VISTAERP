import type { AiTool } from "@/lib/ai/types";
import { ok, fail } from "@/lib/ai/tools/shared";
import { buildDevPrompt, type DevRequest } from "@/lib/ai/devPrompt";

// ============================================================
// "Add a WhatsApp button beside the phone number in the customer ledger."
//
// That is not a question about the ERP's data — it is a change to the ERP. She
// recognises it, works out what it means in terms a developer can act on, and
// drafts the Claude Code task. She does not dispatch it: the draft is staged,
// the user reads the prompt, and approving it is a separate act.
//
// She fills in the substance. lib/devPrompt.ts wraps it in Vista's standing
// development rules, the repo's conventions and the production constraints —
// in code, verbatim, so "do not modify production" never depends on a model
// remembering to type it.
// ============================================================

const prepareDevTask: AiTool = {
  name: "prepare_development_task",
  description:
    "Draft a Claude Code development task for a change the user wants made TO the ERP itself — a new " +
    "button, a screen that should look different, a new field, a bug. Use this when they are asking " +
    "for the software to change, not for information out of it. Do not use it for questions about " +
    "data, and do not use it to 'fix' something you merely suspect. " +
    "Fill each field from what they actually said; ask for anything important that is missing rather " +
    "than inventing it. Say afterwards that the task is drafted and waiting on their approval — it " +
    "is NOT sent to Claude until they approve it.",
  kind: "write",
  perm: "ai.dev",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short imperative title, e.g. 'Add WhatsApp button to Customer Ledger'." },
      objective: { type: "string", description: "What should be true once this is done, in two or three sentences." },
      spoken: { type: "string", description: "The user's own words, as close to verbatim as you have them." },
      existing_to_inspect: {
        type: "array", items: { type: "string" },
        description: "Existing functionality that must be reused rather than rebuilt — name the component, lib or RPC if you know it.",
      },
      areas: { type: "array", items: { type: "string" }, description: "Files, routes or modules likely involved." },
      behaviour: { type: "array", items: { type: "string" }, description: "Required behaviour, one point each." },
      ui: { type: "array", items: { type: "string" }, description: "UI requirements — placement, wording, states." },
      business_rules: { type: "array", items: { type: "string" }, description: "Rules that must keep working untouched." },
      out_of_scope: { type: "array", items: { type: "string" }, description: "What must NOT change. Include anything they said not to touch." },
      testing: { type: "array", items: { type: "string" }, description: "How someone would check it worked." },
    },
    required: ["title", "objective"],
    additionalProperties: false,
  },

  async run(args, ctx) {
    const title = String(args?.title ?? "").trim();
    const objective = String(args?.objective ?? "").trim();
    if (!title || !objective) return fail("I need a title and an objective before I can draft this.");

    const req: DevRequest = {
      title,
      objective,
      spoken: args?.spoken ?? null,
      existing_to_inspect: args?.existing_to_inspect,
      areas: args?.areas,
      behaviour: args?.behaviour,
      ui: args?.ui,
      business_rules: args?.business_rules,
      out_of_scope: args?.out_of_scope,
      testing: args?.testing,
    };

    const prompt = buildDevPrompt(req);

    try {
      const { data, error } = await ctx.sb
        .from("ai_dev_tasks")
        .insert({
          company_id: ctx.companyId,
          user_id: ctx.userId,
          title,
          spoken_request: args?.spoken ?? null,
          prompt,
          status: "draft",
        })
        .select("id")
        .single();
      if (error) throw error;

      const id = (data as any).id as string;

      return ok(
        {
          awaiting_confirmation: {
            action_id: id,
            kind: "development_task",
            title,
            summary: objective,
            prompt,
          },
          instruction:
            "The task is drafted and staged, nothing more. Tell the user what you understood and that " +
            "they should read the prompt and approve it. Do not say it has been sent to Claude.",
        },
        { count: 1, summary: `Drafted development task: ${title}`, link: "/ai" }
      );
    } catch (e: any) {
      console.error("[vista-ai] could not stage dev task", e);
      return fail("I wrote the task but couldn't save it, so there is nothing to approve yet.");
    }
  },
};

export const DEVELOPMENT_TOOLS: AiTool[] = [prepareDevTask];
