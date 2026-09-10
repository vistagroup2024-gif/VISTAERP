"use client";

import { useEffect, useRef, useState } from "react";
import {
  TONES, CUSTOM_TONE, MAX_CUSTOM_BYTES,
  chimeTone, setChimeTone, chimeMuted, setChimeMuted, chimeVolume, setChimeVolume,
  customSound, customSoundName, saveCustomSound, clearCustomSound, playTone,
} from "@/lib/notificationChime";

/**
 * Choosing the notification sound.
 *
 * The one thing this card must be honest about is WHEN the sound plays. It is
 * the tab's chime, for somebody with the ERP open. A phone with the ERP closed
 * plays the sound its own operating system is set to use for the browser's
 * notifications, and no web app can change that one — so the card says so
 * plainly rather than letting somebody pick "Bell" and wonder why their phone
 * still goes ping at night.
 *
 * The choice lives in this browser, like the mute flag it sits beside. That is
 * also how a phone treats a ringtone: a property of the device, not the account.
 */
export default function NotificationSound() {
  const [tone, setTone] = useState<string>("chime");
  const [muted, setMuted] = useState(false);
  const [vol, setVol] = useState(80);
  const [custom, setCustom] = useState<string | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // localStorage is not there on the server, so everything is read after mount.
  useEffect(() => {
    setTone(chimeTone());
    setMuted(chimeMuted());
    setVol(chimeVolume());
    setCustom(customSound());
    setCustomName(customSoundName());
  }, []);

  function choose(id: string) {
    setTone(id); setChimeTone(id); setErr(null); setMsg(null);
    if (!chimeMuted()) playTone(id);          // hear what you just picked
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next); setChimeMuted(next);
    if (!next) playTone(chimeTone());
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(null); setMsg(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("audio/")) { setErr("Choose an audio file — an mp3, m4a, wav or ogg."); return; }
    if (f.size > MAX_CUSTOM_BYTES) {
      setErr(`That file is ${Math.round(f.size / 1024)} KB. Keep it under ${Math.round(MAX_CUSTOM_BYTES / 1024)} KB — a notification sound only needs a second or two.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const uri = String(reader.result);
        saveCustomSound(uri, f.name);
        setCustom(uri); setCustomName(f.name);
        setTone(CUSTOM_TONE); setChimeTone(CUSTOM_TONE);
        setMsg(`“${f.name}” is now your notification sound.`);
        playTone(CUSTOM_TONE);
      } catch (e: any) { setErr(e.message); }
    };
    reader.onerror = () => setErr("That file could not be read.");
    reader.readAsDataURL(f);
    if (fileRef.current) fileRef.current.value = "";   // let the same file be picked again
  }

  function removeCustom() {
    clearCustomSound();
    setCustom(null); setCustomName(null);
    setTone(chimeTone());
    setMsg(null); setErr(null);
  }

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-slate-700">Notification sound</h3>
        <button
          onClick={toggleMute}
          className={`rounded-full px-3 py-1 text-sm font-medium ${muted ? "bg-slate-100 text-slate-500" : "bg-green-100 text-green-700"}`}
          title={muted ? "Sound is off — turn it on and hear it" : "Sound is on — click to mute"}>
          {muted ? "🔇 Sound off" : "🔔 Sound on"}
        </button>
      </div>

      <p className="mt-1 text-sm text-slate-500">
        Plays when a notification arrives <b>while the ERP is open</b> in this browser.
      </p>
      <p className="mt-1 text-xs text-slate-400">
        When the ERP is closed, your phone uses the sound set for browser notifications in its own
        settings — no website can change that one. This choice is saved on this device.
      </p>

      {/* Volume. A browser cannot play louder than the tab itself is set to, so
          this trims down from full rather than pushing past it — the Loud,
          Urgent and Siren tones are what carry across a noisy room. */}
      <div className={`mt-3 flex items-center gap-3 ${muted ? "opacity-60" : ""}`}>
        <span className="w-16 shrink-0 text-xs text-slate-500">Volume</span>
        <input type="range" min={0} max={100} step={5} value={vol}
          onChange={(e) => { const v = Number(e.target.value); setVol(v); setChimeVolume(v); }}
          onMouseUp={() => playTone(chimeTone())} onTouchEnd={() => playTone(chimeTone())}
          className="h-1.5 w-full max-w-xs accent-brand" aria-label="Notification volume" />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-400">{vol}%</span>
      </div>

      {msg && <div className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
      {err && <div className="mt-3 rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <ul className={`mt-3 space-y-1 ${muted ? "opacity-60" : ""}`}>
        {TONES.map((t) => (
          <li key={t.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50">
              <input type="radio" name="tone" checked={tone === t.id} onChange={() => choose(t.id)} className="accent-brand" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800">{t.label}</span>
                <span className="block text-xs text-slate-400">{t.hint}</span>
              </span>
              <button type="button" onClick={(e) => { e.preventDefault(); playTone(t.id); }}
                className="ml-auto shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                aria-label={`Play the ${t.label} tone`}>
                ▶ Play
              </button>
            </label>
          </li>
        ))}

        {custom && (
          <li>
            <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-slate-50">
              <input type="radio" name="tone" checked={tone === CUSTOM_TONE} onChange={() => choose(CUSTOM_TONE)} className="accent-brand" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-800">{customName || "My sound"}</span>
                <span className="block text-xs text-slate-400">Your own file, stored on this device</span>
              </span>
              <span className="ml-auto flex shrink-0 gap-2">
                <button type="button" onClick={(e) => { e.preventDefault(); playTone(CUSTOM_TONE); }}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">▶ Play</button>
                <button type="button" onClick={(e) => { e.preventDefault(); removeCustom(); }}
                  className="rounded-md px-2 py-1 text-xs text-red-500 hover:underline">Remove</button>
              </span>
            </label>
          </li>
        )}
      </ul>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <label className="btn-outline cursor-pointer text-sm">
          {custom ? "Choose a different file…" : "Use my own sound…"}
          <input ref={fileRef} type="file" accept="audio/*" onChange={onFile} className="hidden" />
        </label>
        <span className="ml-2 text-xs text-slate-400">
          mp3, m4a, wav or ogg — under {Math.round(MAX_CUSTOM_BYTES / 1024)} KB
        </span>
      </div>
    </div>
  );
}
