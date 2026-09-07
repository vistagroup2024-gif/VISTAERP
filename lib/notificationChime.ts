// The notification tone.
//
// Synthesised rather than shipped as a file: a two-note chime through the Web
// Audio API is a few lines, needs no asset to download or cache, and cannot be
// the wrong codec on somebody's browser. Nothing is created until the first
// sound is asked for, because a browser will not let a page open an AudioContext
// before the user has interacted with it anyway.
//
// It is NOT played by the service worker — a worker has no audio. This is the
// tab's chime, for someone with the ERP open; a phone with the app closed gets
// the operating system's own notification sound instead.

const MUTE_KEY = "vista:notify:mute";

/** Muted for this browser? Off by default — a notification nobody hears is the
 *  thing being complained about. */
export function chimeMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function setChimeMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* private window */ }
}

let ctx: AudioContext | null = null;

/** A short two-note chime. Safe to call from anywhere: every failure path —
 *  no Web Audio, a context the browser refuses to start, a muted preference —
 *  ends in silence rather than an error. */
export function playChime() {
  if (chimeMuted()) return;
  try {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    // Autoplay policy suspends the context until a gesture; resume is a no-op
    // when it is already running.
    if (ctx.state === "suspended") void ctx.resume();

    const now = ctx.currentTime;
    // Two notes a fourth apart, the second a beat after the first: short enough
    // not to nag, distinct enough to be heard across a room.
    [{ f: 880, t: 0 }, { f: 1174.7, t: 0.13 }].forEach(({ f, t }) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      // Ramp in and out, or the note clicks at both ends.
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.18, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.32);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.34);
    });
  } catch { /* a tone is never worth an exception */ }
}
