"use client";

import { useCallback, useEffect, useState } from "react";
import { dateStr, fmtTime12 } from "@/lib/format";
import Icon from "@/components/ui/Icon";

// ============================================================
// The development pipeline, honestly labelled.
//
// Each step is either something that has observably happened on GitHub or
// something that has not. There is no step here the ERP cannot verify, and no
// "Deploy to production" button — production is reached by a person merging
// the pull request on GitHub, and this screen says so rather than offering a
// button that would only pretend.
//
// Two things this screen deliberately does not claim:
//   * it does not show Claude Code asking permission for a file. The GitHub
//     action is not interactive and emits no such prompt; inventing one would
//     be theatre. What protects the repo is the approval before dispatch, the
//     action's own allowed-tools, and the human merge.
//   * it does not mark checks as passing unless GitHub said they passed.
// ============================================================

interface Task {
  id: string;
  title: string;
  spoken_request: string | null;
  prompt: string;
  status: string;
  issue_number: number | null;
  pr_number: number | null;
  branch: string | null;
  preview_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const STEPS: { key: string; label: string }[] = [
  { key: "draft", label: "Request understood, prompt written" },
  { key: "approved", label: "You approved it" },
  { key: "dispatched", label: "Sent to Claude Code" },
  { key: "working", label: "Claude working on a branch" },
  { key: "in_review", label: "Pull request opened" },
  { key: "preview", label: "Vercel preview ready" },
  { key: "merged", label: "Merged to production by you" },
];

// How far each stored status has actually got.
const REACHED: Record<string, number> = {
  draft: 1, cancelled: 1, failed: 1,
  dispatched: 3, working: 4, in_review: 5, preview: 6, merged: 7,
};

export default function Development() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [github, setGithub] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/dev", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json?.error || "Could not load tasks."); return; }
      setError(null);
      setTasks(json.tasks ?? []);
      setGithub(!!json.github);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (id: string, action: "approve" | "reject" | "refresh") => {
    setBusy(id);
    try {
      const res = await fetch("/api/ai/dev", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json?.error || "That didn't go through.");
      else setError(null);
      await load();
    } finally {
      setBusy(null);
    }
  }, [load]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <p className="text-xs text-slate-500">
          Speak a change you want and she writes the Claude Code task. You approve it, Claude works on
          a branch, and Vercel builds a preview.
        </p>
        <button onClick={load} className="btn-ghost btn-sm shrink-0" disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {!github && (
        <div className="m-4 rounded-md border border-warning/20 bg-warning-soft px-3 py-2 text-sm text-warning-fg">
          The Claude Code connection isn&apos;t set up on this server yet, so tasks can be drafted but
          not sent. An administrator needs to set{" "}
          <span className="font-mono text-xs">GITHUB_TOKEN</span> and{" "}
          <span className="font-mono text-xs">GITHUB_REPO</span>.
        </div>
      )}

      {error && (
        <div className="m-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger-fg">
          {error}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          Nothing yet. Tell her what you want changed — &ldquo;add a WhatsApp button beside the phone
          number in the customer ledger&rdquo; — and it will appear here.
        </p>
      )}

      <ul className="divide-y divide-slate-100">
        {tasks.map((t) => {
          const reached = REACHED[t.status] ?? 1;
          const dead = t.status === "cancelled" || t.status === "failed";
          return (
            <li key={t.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <button
                  onClick={() => setOpen(open === t.id ? null : t.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-sm font-medium text-slate-800">{t.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {dateStr(t.created_at)} {fmtTime12(t.created_at)}
                    {t.issue_number ? ` · issue #${t.issue_number}` : ""}
                    {t.pr_number ? ` · PR #${t.pr_number}` : ""}
                  </p>
                </button>
                <span className={`badge shrink-0 ${
                  t.status === "merged" ? "badge-success"
                  : t.status === "failed" ? "badge-danger"
                  : t.status === "cancelled" ? "badge-neutral"
                  : "badge-warning"
                }`}>
                  {t.status.replace(/_/g, " ")}
                </span>
              </div>

              {t.error && <p className="mt-1 text-xs text-danger-fg">{t.error}</p>}

              {/* The pipeline. A step is ticked only when it has actually
                  happened; everything ahead of it is shown as not yet done. */}
              {!dead && (
                <ol className="mt-2 space-y-1">
                  {STEPS.map((s, i) => {
                    const done = i + 1 <= reached;
                    const current = i + 1 === reached + 1;
                    return (
                      <li key={s.key} className="flex items-center gap-2 text-xs">
                        {done ? (
                          <Icon name="check" size={13} className="shrink-0 text-success" />
                        ) : (
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${current ? "bg-warning" : "bg-slate-300"}`} />
                        )}
                        <span className={done ? "text-slate-600" : "text-slate-400"}>{s.label}</span>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {t.status === "draft" && (
                  <>
                    <button onClick={() => act(t.id, "approve")} disabled={busy === t.id || !github} className="btn w-full sm:w-auto">
                      {busy === t.id ? "Sending…" : "Approve & send to Claude"}
                    </button>
                    <button onClick={() => act(t.id, "reject")} disabled={busy === t.id} className="btn-outline w-full sm:w-auto">
                      Discard
                    </button>
                  </>
                )}
                {t.issue_number && !dead && (
                  <button onClick={() => act(t.id, "refresh")} disabled={busy === t.id} className="btn-outline btn-sm">
                    {busy === t.id ? "Checking…" : "Check progress"}
                  </button>
                )}
                {t.preview_url && (
                  <a href={t.preview_url} target="_blank" rel="noopener noreferrer" className="btn w-full sm:w-auto">
                    Open the preview
                  </a>
                )}
                <button onClick={() => setOpen(open === t.id ? null : t.id)} className="btn-ghost btn-sm">
                  {open === t.id ? "Hide prompt" : "View prompt"}
                </button>
              </div>

              {t.status === "preview" && (
                <p className="mt-2 text-xs text-slate-500">
                  Test the preview. When you&apos;re happy, merge pull request #{t.pr_number} on GitHub
                  yourself — that is what puts it live. Vista AI cannot merge or deploy.
                </p>
              )}

              {open === t.id && (
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-600">
                  {t.prompt}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
