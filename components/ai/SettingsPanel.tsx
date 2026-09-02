"use client";

import { useEffect, useState } from "react";
import { VOICE_LANGUAGES, speechSupported, ttsSupported, hasVoiceFor, type VoiceLang } from "@/lib/ai/voice";
import type { AiSettings } from "@/components/ai/useSettings";

// Assistant settings. What this screen deliberately does NOT show: the API
// key, the model, or anything else that would be a secret in a browser. It
// reports whether the connection is configured, and nothing more.

export default function SettingsPanel({
  settings, update, configured,
}: {
  settings: AiSettings;
  update: (patch: Partial<AiSettings>) => void;
  configured: boolean;
}) {
  const [voiceOk, setVoiceOk] = useState<boolean | null>(null);
  const canListen = speechSupported();
  const canSpeak = ttsSupported();

  // Whether this device actually has a voice for the chosen language. Said
  // plainly here rather than discovered when she silently fails to speak.
  useEffect(() => {
    let alive = true;
    hasVoiceFor(settings.language).then((ok) => { if (alive) setVoiceOk(ok); });
    return () => { alive = false; };
  }, [settings.language]);

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
      <Section title="Voice">
        <Toggle
          label="Microphone"
          hint={canListen
            ? "Speak to her instead of typing."
            : "This browser has no speech recognition. Chrome, Edge or Safari do."}
          checked={settings.voice_input && canListen}
          disabled={!canListen}
          onChange={(v) => update({ voice_input: v })}
        />
        <Toggle
          label="Spoken replies"
          hint={canSpeak
            ? "She reads her answers aloud as well as showing them."
            : "This browser can't read text aloud."}
          checked={settings.voice_output && canSpeak}
          disabled={!canSpeak}
          onChange={(v) => update({ voice_output: v })}
        />
        <Toggle
          label="Hands-free"
          hint="The microphone stays open. A pause ends your sentence, and talking over her stops her."
          checked={settings.hands_free}
          disabled={!canListen || !settings.voice_input}
          onChange={(v) => update({ hands_free: v })}
        />

        <div className="pt-1">
          <label className="label">Language</label>
          <select
            className="select w-auto"
            value={settings.language}
            onChange={(e) => update({ language: e.target.value as VoiceLang })}
          >
            {VOICE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label} — {l.native}</option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-slate-500">
            Sets what the microphone listens for and which voice reads replies. She understands all
            three whichever is selected — including Urdu written in Roman script — and answers in
            whichever you used.
          </p>
          {voiceOk === false && settings.voice_output && (
            <p className="mt-1.5 text-xs text-warning-fg">
              This device has no voice installed for {VOICE_LANGUAGES.find((l) => l.code === settings.language)?.label}.
              She&apos;ll show her answer instead of speaking it.
            </p>
          )}
        </div>
      </Section>

      <Section title="Actions">
        <p className="text-sm text-slate-500">
          Anything that sends, posts or changes a record is confirmed with you first, every time.
          That is not a preference and cannot be switched off. She is also bound by your own ERP
          permissions — she can never reach something you can&apos;t.
        </p>
      </Section>

      <Section title="Connection">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${configured ? "bg-success" : "bg-danger"}`} />
          <span className="text-slate-700">
            {configured ? "Vista AI is connected." : "No API key is configured on the server."}
          </span>
        </div>
        {!configured && (
          <p className="mt-1.5 text-xs text-slate-500">
            An administrator needs to set <span className="font-mono">ANTHROPIC_API_KEY</span> in the
            deployment environment.
          </p>
        )}
      </Section>

      <Section title="Privacy">
        <p className="text-sm leading-relaxed text-slate-500">
          Speech recognition is your browser&apos;s, not Vista&apos;s — in Chrome that means the audio
          goes to Google for transcription. Only the resulting text reaches Vista AI. Your
          conversations are visible to you alone; what she did with the ERP is in the Activity tab
          and in the ERP&apos;s audit trail, where your managers can see it.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="form-section-title">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({
  label, hint, checked, disabled, onChange,
}: {
  label: string; hint?: string; checked: boolean; disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand focus:ring-brand/30"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
