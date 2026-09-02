"use client";

import { useState } from "react";

// ============================================================
// The confirmation. Nothing has happened yet when this appears, and nothing
// happens unless the person presses the right-hand button.
//
// It shows the real consequence — who, how many, how much — and the actual
// message text, not a paraphrase of it. Approving something you were only
// told about in summary is not approving it.
// ============================================================

export interface PendingAction {
  action_id: string;
  kind: string;
  title: string;
  summary?: string | null;
  total_outstanding?: number;
  currency?: string;
  recipients?: { name: string; phone: string; outstanding: number; message: string }[];
  skipped?: { name: string; reason: string }[];
  /** development_task only: the full Claude Code prompt, to be read before approving. */
  prompt?: string;
}

export interface ActionOutcome {
  ok: boolean;
  message: string;
  sent?: number;
  failed?: number;
  total?: number;
  failures?: { name: string; error: string }[];
}

const money = (n: number, ccy = "SAR") =>
  `${ccy} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

export default function ConfirmCard({
  action, onDecided,
}: {
  action: PendingAction;
  /** Reports what actually happened, so the conversation can be told. */
  onDecided: (outcome: ActionOutcome | { cancelled: true }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ActionOutcome | { cancelled: true } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const isDev = action.kind === "development_task";
  const recipients = action.recipients ?? [];
  const shown = showAll ? recipients : recipients.slice(0, 3);

  async function decide(decision: "confirm" | "cancel") {
    setBusy(true);
    setError(null);
    try {
      // A development task is approved on its own endpoint: approving it is
      // what hands it to Claude Code, and that is a different act from
      // confirming a send.
      const res = isDev
        ? await fetch("/api/ai/dev", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: action.action_id, action: decision === "confirm" ? "approve" : "reject" }),
          })
        : await fetch("/api/ai/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: action.action_id, decision }),
          });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) { setError(json?.error || "That didn't go through."); return; }

      const outcome = decision === "cancel"
        ? ({ cancelled: true } as const)
        : isDev
        ? ({
            ok: true,
            message: json.issue_number
              ? `Sent to Claude Code as issue #${json.issue_number}. It will work on a branch and open a pull request; nothing goes to production without your approval.`
              : "Approved.",
          } as ActionOutcome)
        : (json as ActionOutcome);
      setDone(outcome);
      onDecided(outcome);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  // ---- After the decision -------------------------------------------------
  if (done) {
    if ("cancelled" in done) {
      return (
        <Shell tone="neutral">
          <p className="text-sm text-slate-600">
            {isDev ? "Discarded. Nothing was sent to Claude." : "Cancelled. Nothing was sent."}
          </p>
        </Shell>
      );
    }
    return (
      <Shell tone={done.ok && !done.failed ? "success" : done.ok ? "warning" : "danger"}>
        <p className="text-sm font-medium text-slate-800">{done.message}</p>
        {!!done.failures?.length && (
          <ul className="mt-2 space-y-0.5 text-xs text-danger-fg">
            {done.failures.map((f, i) => <li key={i}>{f.name} — {f.error}</li>)}
          </ul>
        )}
      </Shell>
    );
  }

  // ---- Waiting on the person ---------------------------------------------
  return (
    <Shell tone="pending">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{action.title}</h3>
          {action.summary && <p className="mt-0.5 text-xs text-slate-500">{action.summary}</p>}
        </div>
        {action.total_outstanding != null && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Outstanding</div>
            <div className="text-sm font-semibold tabular-nums text-slate-900">
              {money(action.total_outstanding, action.currency)}
            </div>
          </div>
        )}
      </div>

      {isDev && action.prompt && (
        <div className="mt-3">
          <button
            onClick={() => setShowPrompt((v) => !v)}
            className="text-xs font-medium text-brand hover:underline"
          >
            {showPrompt ? "Hide the prompt" : "Read the prompt before approving"}
          </button>
          {showPrompt && (
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-2.5 font-mono text-[11px] leading-relaxed text-slate-600">
              {action.prompt}
            </pre>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Approving opens an issue for Claude Code. It works on a branch and opens a pull request,
            and Vercel builds a preview from it. Nothing reaches production until you merge it
            yourself.
          </p>
        </div>
      )}

      {recipients.length > 0 && (
        <div className="mt-3 space-y-2">
          {shown.map((r, i) => (
            <div key={i} className="rounded-md border border-slate-200 bg-white p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-slate-800">{r.name}</span>
                <span className="shrink-0 font-mono text-[11px] text-slate-400">{r.phone}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">
                {r.message}
              </p>
            </div>
          ))}
          {recipients.length > 3 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="text-xs font-medium text-brand hover:underline"
            >
              {showAll ? "Show fewer" : `Show all ${recipients.length}`}
            </button>
          )}
        </div>
      )}

      {!!action.skipped?.length && (
        <p className="mt-2 text-xs text-warning-fg">
          Skipping {action.skipped.length}: {action.skipped.map((s) => s.name).join(", ")} — no usable
          WhatsApp number.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-danger-fg">{error}</p>}

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button onClick={() => decide("cancel")} disabled={busy} className="btn-outline w-full sm:w-auto">
          Cancel
        </button>
        <button onClick={() => decide("confirm")} disabled={busy} className="btn w-full sm:w-auto">
          {busy
            ? "Sending…"
            : isDev
            ? "Approve & send to Claude"
            : `Confirm & send${recipients.length ? ` (${recipients.length})` : ""}`}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ tone, children }: { tone: "pending" | "success" | "warning" | "danger" | "neutral"; children: React.ReactNode }) {
  const border =
    tone === "success" ? "border-success/30 bg-success-soft/40"
    : tone === "warning" ? "border-warning/30 bg-warning-soft/40"
    : tone === "danger" ? "border-danger/30 bg-danger-soft/40"
    : tone === "neutral" ? "border-slate-200 bg-slate-50"
    : "border-brand-200 bg-brand-50";
  return <div className={`max-w-[92%] rounded-lg border p-3.5 ${border}`}>{children}</div>;
}
