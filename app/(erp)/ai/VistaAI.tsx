"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AvatarStage, { type AvatarState } from "@/components/ai/AvatarStage";
import Transcript, { type Turn, type ToolEvent } from "@/components/ai/Transcript";
import Activity from "@/components/ai/Activity";
import SettingsPanel from "@/components/ai/SettingsPanel";
import { useSettings } from "@/components/ai/useSettings";
import { useVoice } from "@/components/ai/useVoice";
import { speechSupported } from "@/lib/ai/voice";
import Icon from "@/components/ui/Icon";

// ============================================================
// Vista AI — the assistant shell.
//
// She listens, reaches into the ERP through permission-checked tools, answers
// from real data, and reads the answer back when asked to. Write actions, the
// daily priorities and the development workflow are the phases after this one,
// and the tabs for them say so rather than pretending.
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

  const { settings, update } = useSettings();
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  // A question asked while she is still working. She is interrupted, and this
  // is what she turns to next — dropping it would lose what the user said.
  const queued = useRef<string | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question) return;

    // Interrupting: cut the answer in flight and let its own cleanup pick this
    // up, so the two turns never run over each other.
    if (busyRef.current) {
      queued.current = question;
      abortRef.current?.abort();
      return;
    }

    setInput("");
    setBusy(true);
    busyRef.current = true;

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
    let spoken = "";

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
            spoken += ev.delta;
            patch((t) => ({ ...t, text: t.text + ev.delta }));
          } else if (ev.type === "tool") {
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
        // Barge-in or Stop. What she managed to say stands; it isn't read out.
        spoken = "";
        patch((t) => ({ ...t, streaming: false }));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      busyRef.current = false;
      // Read the answer only once it is whole — reading each chunk as it
      // arrives makes her stutter.
      if (spoken.trim() && settings.voice_output) sayRef.current?.(spoken);

      const next = queued.current;
      if (next) { queued.current = null; askRef.current?.(next); }
    }
  }, [settings.voice_output]);

  // Lets the cleanup above re-enter `ask` without `ask` depending on itself.
  const askRef = useRef(ask);
  useEffect(() => { askRef.current = ask; }, [ask]);

  const voice = useVoice({
    language: settings.language,
    handsFree: settings.hands_free && settings.voice_input,
    onPhrase: ask,
    onBargeIn: stop,
  });

  // `ask` needs to speak, and the voice hook needs `ask`. A ref breaks the
  // circle without either of them re-creating the other on every render.
  const sayRef = useRef(voice.say);
  useEffect(() => { sayRef.current = voice.say; }, [voice.say]);

  // Turning spoken replies off should silence her immediately, not after the
  // sentence she is in the middle of.
  const hush = voice.hush;
  useEffect(() => { if (!settings.voice_output) hush(); }, [settings.voice_output, hush]);

  const state: AvatarState =
    voice.speaking ? "speaking" : voice.listening ? "listening" : busy ? "thinking" : "idle";

  const micAvailable = settings.voice_input && speechSupported();

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
      {/* Presence. On mobile it sits above the conversation and shrinks. */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="hidden lg:block">
          <AvatarStage state={state} level={voice.level} />
        </div>
        <div className="lg:hidden">
          <AvatarStage state={state} level={voice.level} compact />
        </div>
      </div>

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
            {voice.error && (
              <div className="flex items-start justify-between gap-3 border-b border-warning/20 bg-warning-soft px-5 py-2.5 text-sm text-warning-fg">
                <span>{voice.error}</span>
                <button onClick={voice.clearError} className="shrink-0 text-xs underline">dismiss</button>
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

            {/* What she is hearing, while she hears it. */}
            {voice.interim && (
              <div className="border-t border-slate-100 px-4 py-2 text-sm italic text-slate-400">
                {voice.interim}
              </div>
            )}

            <form
              onSubmit={(e) => { e.preventDefault(); ask(input); }}
              className="flex items-end gap-2 border-t border-slate-200 p-3"
            >
              {micAvailable && (
                <button
                  type="button"
                  onClick={voice.toggleListening}
                  disabled={!configured || settings.hands_free}
                  title={settings.hands_free ? "Hands-free is on — the microphone stays open" : "Speak"}
                  aria-label={voice.listening ? "Stop listening" : "Speak"}
                  className={`shrink-0 rounded-md p-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    voice.listening
                      ? "bg-brand text-white"
                      : "border border-slate-300 text-slate-600 hover:border-brand hover:text-brand"
                  }`}
                >
                  <MicIcon active={voice.listening} />
                </button>
              )}

              <textarea
                className="input max-h-32 min-h-[2.5rem] resize-none py-2"
                rows={1}
                placeholder={
                  settings.hands_free && voice.listening ? "Listening — just speak…" : "Ask Vista AI…"
                }
                value={input}
                disabled={!configured}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
                }}
              />

              {busy || voice.speaking ? (
                <button
                  type="button"
                  onClick={() => { stop(); voice.hush(); }}
                  className="btn-outline shrink-0"
                >
                  Stop
                </button>
              ) : (
                <button type="submit" className="btn shrink-0" disabled={!configured || !input.trim()}>
                  Send
                </button>
              )}
            </form>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              {micAvailable && (
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="h-3 w-3 rounded border-slate-300 text-brand focus:ring-brand/30"
                    checked={settings.hands_free}
                    onChange={(e) => update({ hands_free: e.target.checked })}
                  />
                  Hands-free
                </label>
              )}
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  className="h-3 w-3 rounded border-slate-300 text-brand focus:ring-brand/30"
                  checked={settings.voice_output}
                  onChange={(e) => update({ voice_output: e.target.checked })}
                />
                Speak replies
              </label>
              <span>Everything she quotes is read live from the ERP under your own permissions.</span>
            </div>
          </>
        )}

        {tab === "activity" && <Activity />}
        {tab === "settings" && (
          <SettingsPanel settings={settings} update={update} configured={configured} />
        )}

        {tab === "tasks" && (
          <Placeholder
            title="Tasks"
            body="The things she has prepared for you and is waiting on — WhatsApp reminders queued for
                  confirmation, follow-ups, and the day's priority list. Arrives with the write actions
                  in phases 6 and 7."
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

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={active ? "animate-pulse" : ""} aria-hidden>
      <path d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" />
      <path d="M19 11a7 7 0 01-14 0M12 18v3M8 21h8" />
    </svg>
  );
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
