// The notification tone, and the user's choice of it.
//
// Synthesised rather than shipped as files: each built-in tone is a handful of
// notes through the Web Audio API, so there is no asset to download or cache and
// none of them can be the wrong codec on somebody's browser. Nothing is created
// until the first sound is asked for, because a browser will not let a page open
// an AudioContext before the user has interacted with it anyway.
//
// A user may also upload their own sound. That one IS a file, held as a data URI
// in this browser's localStorage and played through an <audio> element.
//
// WHAT THIS IS NOT. None of it is the sound a phone makes when the ERP is
// CLOSED. That notification is drawn by the operating system from the service
// worker, a worker has no audio, and web push cannot name a sound — the
// Notification API's `sound` property was dropped and no browser implements it.
// The closed-app sound is the one the user sets for Chrome / Safari
// notifications in their own device settings. Everything here is the tab's
// chime, for somebody with the ERP open. Say so on any screen that offers it,
// or it reads as a promise the browser will not keep.
//
// The choice is per browser, like the mute flag beside it — the same shape as
// WhatsApp, where the tone is a property of the phone rather than the account.

const MUTE_KEY   = "vista:notify:mute";
const VOL_KEY    = "vista:notify:volume";
const TONE_KEY   = "vista:notify:tone";
const CUSTOM_KEY = "vista:notify:tone:custom";
const CUSTOM_NAME_KEY = "vista:notify:tone:customName";

/** Biggest upload we will keep. A 2-3 second notification sound is 15-50 KB; the
 *  cap is generous for that and still well inside the ~5 MB localStorage gives an
 *  origin, remembering base64 inflates a file by a third. */
export const MAX_CUSTOM_BYTES = 300 * 1024;

type Note = { f: number; t: number; d?: number; type?: OscillatorType; gain?: number };

/** 0-100, how loud the tone is played. The quiet tones were the complaint: a
 *  chime at 0.18 gain is easy to miss across a room, and the browser gives no
 *  way to exceed the tab's own volume, so the loud tones below carry more of
 *  their level in the waveform (square and sawtooth are far more present than a
 *  sine at the same gain) rather than in a number that cannot go higher. */
export function chimeVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 80;
  } catch { return 80; }
}
export function setChimeVolume(v: number) {
  try { localStorage.setItem(VOL_KEY, String(Math.max(0, Math.min(100, Math.round(v))))); } catch { /* private window */ }
}

/** The built-in tones. `notes` is what the oscillator plays; nothing else. */
export const TONES: { id: string; label: string; hint: string; notes: Note[] }[] = [
  { id: "chime",  label: "Chime",  hint: "Two notes, a fourth apart — the original",
    notes: [{ f: 880, t: 0 }, { f: 1174.7, t: 0.13 }] },
  { id: "ping",   label: "Ping",   hint: "One short high note",
    notes: [{ f: 1568, t: 0, d: 0.18 }] },
  { id: "bell",   label: "Bell",   hint: "A struck bell, slow to fade",
    notes: [{ f: 1046.5, t: 0, d: 0.9, gain: 0.16 }, { f: 1568, t: 0.005, d: 0.7, gain: 0.07 }] },
  { id: "soft",   label: "Soft",   hint: "Low and gentle, for a quiet office",
    notes: [{ f: 523.3, t: 0, d: 0.4, type: "triangle", gain: 0.14 }, { f: 659.3, t: 0.1, d: 0.4, type: "triangle", gain: 0.12 }] },
  { id: "rise",   label: "Rise",   hint: "Three notes going up",
    notes: [{ f: 587.3, t: 0, d: 0.2 }, { f: 784, t: 0.1, d: 0.2 }, { f: 1046.5, t: 0.2, d: 0.3 }] },
  { id: "alert",  label: "Alert",  hint: "Two urgent beeps — hard to miss",
    notes: [{ f: 1318.5, t: 0, d: 0.12, type: "square", gain: 0.1 },
            { f: 1318.5, t: 0.18, d: 0.12, type: "square", gain: 0.1 }] },

  // The loud end. A browser cannot play above the tab's own volume, so these
  // get their presence from the waveform and from repeating, not from a gain
  // number that has nowhere left to go: square and sawtooth carry far more
  // energy in the harmonics than a sine at the same level, which is exactly
  // what cuts through a room.
  { id: "loud",   label: "Loud",   hint: "Louder, brighter — for a busy office",
    notes: [{ f: 987.8, t: 0, d: 0.22, type: "square", gain: 0.34 },
            { f: 1318.5, t: 0.16, d: 0.28, type: "square", gain: 0.34 }] },
  { id: "urgent", label: "Urgent", hint: "Four hard beeps, impossible to miss",
    notes: [0, 0.16, 0.32, 0.48].map((t) => ({ f: 1567.98, t, d: 0.11, type: "square" as OscillatorType, gain: 0.38 })) },
  { id: "siren",  label: "Siren",  hint: "Rising and falling, keeps going for a second",
    notes: [
      { f: 740, t: 0,    d: 0.16, type: "sawtooth", gain: 0.3 },
      { f: 988, t: 0.15, d: 0.16, type: "sawtooth", gain: 0.32 },
      { f: 740, t: 0.30, d: 0.16, type: "sawtooth", gain: 0.3 },
      { f: 988, t: 0.45, d: 0.16, type: "sawtooth", gain: 0.32 },
      { f: 740, t: 0.60, d: 0.16, type: "sawtooth", gain: 0.3 },
      { f: 988, t: 0.75, d: 0.30, type: "sawtooth", gain: 0.34 },
    ] },
];

export const DEFAULT_TONE = "chime";
/** The id stored when the user has uploaded their own sound. */
export const CUSTOM_TONE = "custom";

/* ── the stored preference ─────────────────────────────────────────────────
 * Every read is wrapped: a private window, or a browser set to block site
 * data, throws on access rather than returning null. A tone preference is
 * never worth an exception, so each falls back to the default.
 */

/** Muted for this browser? Off by default — a notification nobody hears is the
 *  thing being complained about. */
export function chimeMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function setChimeMuted(muted: boolean) {
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* private window */ }
}

/** The chosen tone id. Falls back to the default if the stored one is a tone we
 *  no longer ship, or is "custom" with nothing uploaded behind it. */
export function chimeTone(): string {
  try {
    const t = localStorage.getItem(TONE_KEY);
    if (!t) return DEFAULT_TONE;
    if (t === CUSTOM_TONE) return customSound() ? CUSTOM_TONE : DEFAULT_TONE;
    return TONES.some((x) => x.id === t) ? t : DEFAULT_TONE;
  } catch { return DEFAULT_TONE; }
}
export function setChimeTone(id: string) {
  try { localStorage.setItem(TONE_KEY, id); } catch { /* private window */ }
}

/** The uploaded sound as a data URI, or null. */
export function customSound(): string | null {
  try { return localStorage.getItem(CUSTOM_KEY); } catch { return null; }
}
export function customSoundName(): string | null {
  try { return localStorage.getItem(CUSTOM_NAME_KEY); } catch { return null; }
}

/** Keep an uploaded sound. Throws with a sentence fit to show the user — the
 *  caller has a message area and the failures here are all things they can act
 *  on (wrong kind of file, too big, no room left). */
export function saveCustomSound(dataUri: string, name: string) {
  if (!/^data:audio\//i.test(dataUri)) throw new Error("That file is not an audio file.");
  try {
    localStorage.setItem(CUSTOM_KEY, dataUri);
    localStorage.setItem(CUSTOM_NAME_KEY, name);
  } catch {
    throw new Error("There is no room left in this browser to store the sound. Try a shorter clip.");
  }
}
export function clearCustomSound() {
  try {
    localStorage.removeItem(CUSTOM_KEY);
    localStorage.removeItem(CUSTOM_NAME_KEY);
    if (localStorage.getItem(TONE_KEY) === CUSTOM_TONE) localStorage.setItem(TONE_KEY, DEFAULT_TONE);
  } catch { /* private window */ }
}

/* ── playing ─────────────────────────────────────────────────────────────── */

let ctx: AudioContext | null = null;

function playNotes(notes: Note[]) {
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return;
  ctx = ctx ?? new AC();
  // Autoplay policy suspends the context until a gesture; resume is a no-op
  // when it is already running.
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const vol = chimeVolume() / 100;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type ?? "sine";
    osc.frequency.value = n.f;
    const dur = n.d ?? 0.32;
    const peak = Math.max(0.0002, (n.gain ?? 0.18) * vol);
    // Ramp in and out, or the note clicks at both ends.
    gain.gain.setValueAtTime(0.0001, now + n.t);
    gain.gain.exponentialRampToValueAtTime(peak, now + n.t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + n.t);
    osc.stop(now + n.t + dur + 0.02);
  }
}

function playDataUri(uri: string) {
  const a = new Audio(uri);
  a.volume = Math.max(0, Math.min(1, chimeVolume() / 100));
  // A browser that has had no gesture yet rejects play(); that is a silent
  // notification, not an error worth surfacing.
  void a.play().catch(() => { /* ignore */ });
}

/** Play a specific tone, whatever the saved preference is — what the Play
 *  button beside each tone in Settings calls. Ignores mute on purpose: pressing
 *  Play is a request to hear it. */
export function playTone(id: string) {
  try {
    if (id === CUSTOM_TONE) {
      const uri = customSound();
      if (uri) playDataUri(uri);
      return;
    }
    playNotes((TONES.find((t) => t.id === id) ?? TONES[0]).notes);
  } catch { /* a tone is never worth an exception */ }
}

/** The notification sound: the user's chosen tone, unless they muted it.
 *  Safe to call from anywhere — every failure path ends in silence. */
export function playChime() {
  if (chimeMuted()) return;
  playTone(chimeTone());
}
