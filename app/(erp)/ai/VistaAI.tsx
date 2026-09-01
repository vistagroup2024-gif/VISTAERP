"use client";

import { useCallback, useRef, useState } from "react";
import AvatarStage, { type AvatarState } from "@/components/ai/AvatarStage";
import Transcript, { type Turn, type ToolEvent } from "@/components/ai/Transcript";
import Activity from "@/components/ai/Activity";
import Icon from "@/components/ui/Icon";

// ============================================================
// Vista AI — the assistant shell.
//
// Phase 2 of the plan: she listens to typing, reaches into the ERP through
// permission-checked tools, and answers from real data. Voice, the avatar
// video, page context, write actions and the development workflow are the
// phases after this one, and the tabs below say so rather than pretending.
// ============================================================

type Tab = "conversation" | "tasks" | "development" | "activity" | "settings";

const TABS: { key: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { key: "conversation", label: "Conversation", icon: "receipt" },
  { key: "tasks", label: "Tasks", icon: "check" },
  { key: "development", label: "Development", icon: "masters" },
  { key: "activity", label: "Activity", icon: "clock" },
  { key: "settings", label: "Settings", icon: "settings" },
];

const QUICK: { label: string; prompt: string }[] = [
  { label: "Today's summary", prompt: "Give me today's accounting summary." },
  { label: "Outstanding", prompt: "Show me today's outstanding." },
  { label: "Overdue customers", prompt: "Which customers are overdue?" },
  { label: "Pending transport", prompt: "What transport is pending today?" },
  { label: "Today's check-ins", prompt: "Show me today's hotel check-ins." },
  { label: "Awaiting approval", prompt: "What vouchers are waiting for authorisation?" },
];

let uid = 0;
const nextId = () => `t${++uid}`;

export default function VistaAI({ configured }: { configured: boolean }) {
  const [tab, setTab] = useState<Tab>("conversation");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<AvatarState>("idle");
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    setInput("");
    setBusy(true);
    setState("thinking");

    const answerId = nextId();
    setTurns((prev) => [
      ...prev,
      { id: nextId(), role: "user", text: question },
      { id: answerId, role: "assistant", text: "", tools: [], streaming: true },
    ]);

    const patch = (fn: (t: Turn) => Turn) =>
      setTurns((prev) => prev.map((t) => (t.id === answerId ? fn(t) : t)));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: question,
          conversation_id: conversationId.current,
          page: null, // page/entity context arrives in phase 5
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        patch((t) => ({ ...t, streaming: false, error: j?.error || "Vista AI could not be reached." }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;

          let ev: any;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }

          if (ev.type === "conversation") {
            conversationId.current = ev.id ?? null;
          } else if (ev.type === "text") {
            setState("speaking");
            patch((t) => ({ ...t, text: t.text + ev.delta }));
          } else if (ev.type === "tool") {
            setState("thinking");
            patch((t) => ({ ...t, tools: mergeTool(t.tools ?? [], ev) }));
          } else if (ev.type === "error") {
            patch((t) => ({ ...t, error: ev.message }));
          }
        }
      }

      patch((t) => ({ ...t, streaming: false }));
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        patch((t) => ({ ...t, streaming: false, error: "The connection to Vista AI dropped." }));
      } else {
        patch((t) => ({ ...t, streaming: false }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setState("idle");
    }
  }, [busy]);

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
      {/* Presence. On mobile it sits above the conversation and shrinks. */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="hidden lg:block">
          <AvatarStage state={state} />
        </div>
        <div className="lg:hidden">
          <AvatarStage state={state} compact />
        </div>
      </div>

      {/* Conversation and the rest of the tabs. */}
      <div className="panel flex min-h-[70vh] flex-col lg:min-h-[calc(100vh-9rem)]">
        <nav className="flex overflow-x-auto border-b border-slate-200 px-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-brand text-brand-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon name={t.icon} size={15} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        {tab === "conversation" && (
          <>
            {!configured && (
              <div className="border-b border-warning/20 bg-warning-soft px-5 py-3 text-sm text-warning-fg">
                Vista AI has no API key configured on the server yet, so she cannot answer. An
                administrator needs to set <span className="font-mono text-xs">ANTHROPIC_API_KEY</span>.
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <Transcript turns={turns} busy={busy} />
            </div>

            {turns.length === 0 && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
                {QUICK.map((q) => (
                  <button
                    key={q.label}
                    onClick={() => ask(q.prompt)}
                    disabled={!configured}
                    className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); ask(input); }}
              className="flex items-end gap-2 border-t border-slate-200 p-3"
            >
              <textarea
                className="input max-h-32 min-h-[2.5rem] resize-none py-2"
                rows={1}
                placeholder="Ask Vista AI…"
                value={input}
                disabled={!configured}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
                }}
              />
              {busy ? (
                <button type="button" onClick={stop} className="btn-outline shrink-0">
                  Stop
                </button>
              ) : (
                <button type="submit" className="btn shrink-0" disabled={!configured || !input.trim()}>
                  Send
                </button>
              )}
            </form>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              Voice and hands-free arrive in phase 3. Everything she quotes is read live from the ERP
              under your own permissions.
            </p>
          </>
        )}

        {tab === "activity" && <Activity />}

        {tab === "tasks" && (
          <Placeholder
            title="Tasks"
            body="The things she has prepared for you and is waiting on — WhatsApp reminders queued for
                  confirmation, follow-ups, and the day's priority list. Arrives with the write actions
                  in phase 6/7."
          />
        )}
        {tab === "development" && (
          <Placeholder
            title="Development"
            body="Speak a change you want to the ERP, review the Claude Code prompt she writes, and watch
                  the task through to a Vercel preview. Arrives in phases 8 and 9. Production stays
                  behind your own explicit approval, always."
          />
        )}
        {tab === "settings" && (
          <Placeholder
            title="Settings"
            body="Voice on/off, voice language, hands-free, avatar and confirmation preferences.
                  Arrives with the voice layer in phase 3."
          />
        )}
      </div>
    </div>
  );
}

function mergeTool(tools: ToolEvent[], ev: ToolEvent): ToolEvent[] {
  // A tool announces itself when it starts and again when it finishes; the
  // finished line replaces the running one rather than stacking beneath it.
  const i = tools.findIndex((t) => t.name === ev.name && t.status === "running");
  if (i >= 0 && ev.status !== "running") {
    const next = tools.slice();
    next[i] = ev;
    return next;
  }
  return [...tools, ev];
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{body}</p>
      </div>
    </div>
  );
}
