import { createClient } from "@/lib/supabase/server";
import { getStaffAccess, getSessionUser, staffCan } from "@/lib/staffSession";
import { dispatchTask, taskStatus, githubConfigured } from "@/lib/ai/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================
// The development workflow's control surface.
//
//   list     — the tasks, for the Development screen
//   approve  — the user has read the prompt and wants it sent. THIS is what
//              hands it to Claude Code; the model cannot reach this endpoint.
//   reject   — bin the draft
//   refresh  — read GitHub back: PR, checks, preview URL
//
// There is no deploy action, and there is deliberately no way to add one from
// here: the token carries no workflow scope and nothing in this file merges a
// pull request. Production is reached only by a person merging to main or
// running the manual deploy workflow on GitHub. Requirement §27 is enforced by
// the absence of a code path, not by a flag someone could flip.
// ============================================================

export async function POST(req: Request) {
  const sb = createClient();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const access = await getStaffAccess();
  if (!staffCan(access, "ai.dev")) {
    return Response.json(
      { error: "You're not allowed to commission ERP development. An administrator grants that." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({} as any));
  const action = String(body?.action ?? "list");

  // ---- list ---------------------------------------------------------------
  if (action === "list") {
    const { data, error } = await sb
      .from("ai_dev_tasks")
      .select("id, title, spoken_request, prompt, status, issue_number, pr_number, branch, preview_url, error, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, tasks: data ?? [], github: githubConfigured() });
  }

  const id = String(body?.id ?? "");
  if (!id) return Response.json({ error: "Which task?" }, { status: 400 });

  const { data: row, error: loadError } = await sb
    .from("ai_dev_tasks")
    .select("id, title, prompt, status, issue_number, user_id")
    .eq("id", id)
    .maybeSingle();
  if (loadError) return Response.json({ error: loadError.message }, { status: 400 });
  if (!row) return Response.json({ error: "That task no longer exists." }, { status: 404 });

  const task = row as any;

  // ---- reject -------------------------------------------------------------
  if (action === "reject") {
    if (task.status !== "draft") {
      return Response.json({ error: `That task is already ${task.status}.` }, { status: 409 });
    }
    await sb.from("ai_dev_tasks")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", id);
    await log(sb, "development_task_rejected", { task_id: id, ok: true });
    return Response.json({ ok: true, status: "cancelled" });
  }

  // ---- approve: this is the moment it goes to Claude Code -----------------
  if (action === "approve") {
    if (task.status !== "draft") {
      return Response.json({ error: `That task is already ${task.status}.` }, { status: 409 });
    }
    if (!githubConfigured()) {
      return Response.json(
        {
          error:
            "The Claude Code connection isn't set up on this server yet, so I can't send it. An " +
            "administrator needs to set GITHUB_TOKEN and GITHUB_REPO.",
        },
        { status: 503 }
      );
    }

    try {
      const { issue_number, issue_url } = await dispatchTask(task.title, task.prompt);
      await sb.from("ai_dev_tasks")
        .update({ status: "dispatched", issue_number, error: null, updated_at: new Date().toISOString() })
        .eq("id", id);
      await log(sb, "development_task_dispatched", { task_id: id, issue_number, ok: true });
      return Response.json({ ok: true, status: "dispatched", issue_number, issue_url });
    } catch (e: any) {
      const message = e?.message || "Could not reach GitHub.";
      await sb.from("ai_dev_tasks")
        .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
        .eq("id", id);
      await log(sb, "development_task_dispatched", { task_id: id, ok: false, error: message });
      return Response.json({ error: message }, { status: 502 });
    }
  }

  // ---- refresh: read GitHub back -----------------------------------------
  if (action === "refresh") {
    if (!task.issue_number) {
      return Response.json({ error: "That task hasn't been sent yet." }, { status: 409 });
    }
    if (!githubConfigured()) {
      return Response.json({ error: "The Claude Code connection isn't configured." }, { status: 503 });
    }

    try {
      const status = await taskStatus(task.issue_number);

      // Only ever moves forward through states we can actually observe. An
      // unknown remains whatever it was rather than being downgraded.
      const next =
        status.pr_merged ? "merged"
        : status.preview_url ? "preview"
        : status.pr_number ? "in_review"
        : "working";

      await sb.from("ai_dev_tasks")
        .update({
          status: next,
          pr_number: status.pr_number,
          branch: status.branch,
          preview_url: status.preview_url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      return Response.json({ ok: true, status: next, github: status });
    } catch (e: any) {
      return Response.json({ error: e?.message || "Could not read GitHub." }, { status: 502 });
    }
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}

async function log(sb: any, tool: string, detail: Record<string, unknown>) {
  try {
    await sb.rpc("ai_log_action", { p_tool: tool, p_kind: "write", p_args: {}, p_result: detail });
  } catch (e) {
    console.error("[vista-ai] audit write failed", tool, e);
  }
}
