"use client";

import { useCallback, useState } from "react";
import AvatarStage, { type AvatarState } from "@/components/ai/AvatarStage";
import Conversation, { type ConversationState } from "@/components/ai/Conversation";
import Activity from "@/components/ai/Activity";
import Tasks from "@/components/ai/Tasks";
import SettingsPanel from "@/components/ai/SettingsPanel";
import { useSettings } from "@/components/ai/useSettings";
import Icon from "@/components/ui/Icon";

// ============================================================
// Vista AI's own screen: the avatar, the conversation, and everything she
// has done. The conversation itself is the shared component — the same one
// the dock opens over any ERP page — so the two can never drift.
//
// No page context here on purpose. Someone who walked to her screen is not
// "looking at" anything else, and inventing a context would only mislead her.
// ============================================================

type Tab = "conversation" | "tasks" | "development" | "activity" | "settings";

const TABS: { key: Tab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { key: "conversation", label: "Conversation", icon: "receipt" },
  { key: "tasks", label: "Tasks", icon: "check" },
  { key: "development", label: "Development", icon: "masters" },
  { key: "activity", label: "Activity", icon: "clock" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export default function VistaAI({ configured }: { configured: boolean }) {
  const [tab, setTab] = useState<Tab>("conversation");
  const [state, setState] = useState<ConversationState>("idle");
  const [level, setLevel] = useState(0);
  const { settings, update } = useSettings();

  const onState = useCallback((s: ConversationState, l: number) => { setState(s); setLevel(l); }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
      {/* Presence. On mobile it sits above the conversation and shrinks. */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="hidden lg:block">
          <AvatarStage state={state as AvatarState} level={level} />
        </div>
        <div className="lg:hidden">
          <AvatarStage state={state as AvatarState} level={level} compact />
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

        {/* The conversation is mounted once and hidden when another tab is on
            top, so switching to Activity and back does not throw away the
            thread — or cut her off mid-sentence. */}
        <div className={tab === "conversation" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <Conversation configured={configured} page={null} onState={onState} />
        </div>

        {tab === "activity" && <Activity />}
        {tab === "settings" && (
          <SettingsPanel settings={settings} update={update} configured={configured} />
        )}

        {tab === "tasks" && <Tasks />}
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
