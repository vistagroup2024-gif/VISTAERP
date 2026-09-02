// ============================================================
// Speech in and out, using what the browser already has.
//
// Recognition is the Web Speech API (SpeechRecognition); synthesis is
// speechSynthesis. Free, no vendor, no key, no per-minute cost, and it
// handles en-US / ar-SA / ur-PK. The honest limits, stated once here so the
// UI can say them out loud rather than failing mysteriously:
//
//   * Recognition needs Chrome, Edge or Safari. Firefox has none, and
//     `speechSupported()` returns false there rather than pretending.
//   * Recognition is a cloud service in Chrome — audio leaves the machine and
//     goes to the browser vendor, not to Vista and not to Anthropic.
//   * Urdu and Arabic synthesis voices vary a lot by device. If the platform
//     has no voice for the language we say so instead of reading Urdu aloud
//     in an English accent.
//
// Everything here is behind one small surface (`listen` / `speak`), so a
// server STT/TTS route can replace the inside later without the UI changing.
// ============================================================

export type VoiceLang = "en-US" | "ar-SA" | "ur-PK";

export const VOICE_LANGUAGES: { code: VoiceLang; label: string; native: string }[] = [
  { code: "en-US", label: "English", native: "English" },
  { code: "ar-SA", label: "Arabic", native: "العربية" },
  { code: "ur-PK", label: "Urdu", native: "اردو" },
];

// --- Minimal typings. The Web Speech API is not in lib.dom. ---------------
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { readonly length: number; isFinal: boolean; [i: number]: SRAlternative }
interface SRResultList { readonly length: number; [i: number]: SRResult }
interface SREvent extends Event { resultIndex: number; results: SRResultList }
interface SRErrorEvent extends Event { error: string; message?: string }

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}

function RecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechSupported(): boolean {
  return RecognitionCtor() !== null;
}

export function ttsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** A one-line reason the microphone is unavailable, or null when it works. */
export function speechUnavailableReason(): string | null {
  if (typeof window === "undefined") return null;
  if (!speechSupported()) {
    return "This browser can't do speech recognition. Chrome, Edge or Safari can.";
  }
  if (!window.isSecureContext) {
    return "The microphone needs a secure (https) connection.";
  }
  return null;
}

// --- Listening ------------------------------------------------------------

export interface ListenHandlers {
  /** Fires as they speak, before the phrase is settled. */
  onInterim?(text: string): void;
  /** Fires once a phrase is settled. In hands-free this fires repeatedly. */
  onFinal?(text: string): void;
  /** Their voice started. Used for barge-in. */
  onSpeechStart?(): void;
  /** Recognition stopped, for any reason. */
  onEnd?(): void;
  onError?(message: string): void;
}

export interface Listener {
  stop(): void;
  abort(): void;
}

/**
 * Start listening. `continuous` is hands-free mode: recognition restarts
 * itself when the browser times it out, so the user can keep talking without
 * touching anything.
 */
export function listen(lang: VoiceLang, handlers: ListenHandlers, continuous = false): Listener | null {
  const Ctor = RecognitionCtor();
  if (!Ctor) {
    handlers.onError?.("This browser can't do speech recognition.");
    return null;
  }

  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  // In hands-free the browser still ends the session periodically; we restart
  // it until the caller actually stops. `wanted` is what the caller asked for,
  // so a restart never fights an explicit stop.
  let wanted = true;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) {
        const settled = text.trim();
        if (settled) handlers.onFinal?.(settled);
      } else {
        interim += text;
      }
    }
    if (interim.trim()) handlers.onInterim?.(interim.trim());
  };

  rec.onspeechstart = () => handlers.onSpeechStart?.();

  rec.onerror = (e) => {
    // "no-speech" and "aborted" are ordinary, not failures worth telling
    // someone about — they happen every time a pause runs long or we stop.
    if (e.error === "no-speech" || e.error === "aborted") return;
    wanted = false;
    handlers.onError?.(
      e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Microphone access was blocked. Allow it in your browser's site settings."
        : e.error === "network"
        ? "Speech recognition couldn't reach the network."
        : `Speech recognition failed (${e.error}).`
    );
  };

  rec.onend = () => {
    if (wanted && continuous) {
      try { rec.start(); return; } catch { /* fall through to ending */ }
    }
    handlers.onEnd?.();
  };

  try {
    rec.start();
  } catch (e: any) {
    handlers.onError?.(e?.message || "Could not start the microphone.");
    return null;
  }

  return {
    stop() { wanted = false; try { rec.stop(); } catch { /* already stopped */ } },
    abort() { wanted = false; try { rec.abort(); } catch { /* already stopped */ } },
  };
}

// --- Speaking -------------------------------------------------------------

// Voices load asynchronously on most browsers, so the first call can find an
// empty list. This resolves once they're actually there.
function voices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!ttsSupported()) return resolve([]);
    const now = window.speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    // Some browsers never fire the event. Don't hang on it.
    setTimeout(done, 1000);
  });
}

/** Whether the device actually has a voice for this language. */
export async function hasVoiceFor(lang: VoiceLang): Promise<boolean> {
  const all = await voices();
  const base = lang.split("-")[0];
  return all.some((v) => v.lang === lang || v.lang.startsWith(base + "-") || v.lang === base);
}

export interface SpeakHandlers {
  /**
   * A 0..1 level for the avatar. speechSynthesis exposes no audio to analyse,
   * so this is driven by the engine's own word-boundary events plus a decay —
   * it tracks the rhythm of her real speech, and it is not pretending to be
   * amplitude or phoneme lip-sync.
   */
  onLevel?(level: number): void;
  onStart?(): void;
  onEnd?(): void;
  onError?(message: string): void;
}

let decayTimer: ReturnType<typeof setInterval> | null = null;

export async function speak(text: string, lang: VoiceLang, handlers: SpeakHandlers = {}): Promise<void> {
  if (!ttsSupported()) { handlers.onError?.("This browser can't read text aloud."); return; }
  const body = text.trim();
  if (!body) return;

  cancelSpeech();

  const utter = new SpeechSynthesisUtterance(body);
  utter.lang = lang;
  utter.rate = 1.02;   // a shade brisk, the way someone competent talks
  utter.pitch = 1;

  const all = await voices();
  const base = lang.split("-")[0];
  const match =
    all.find((v) => v.lang === lang) ??
    all.find((v) => v.lang.startsWith(base + "-")) ??
    all.find((v) => v.lang === base);
  if (match) utter.voice = match;
  else if (base !== "en") {
    // Reading Urdu aloud with an English voice is worse than not reading it.
    handlers.onError?.(
      `This device has no ${base === "ar" ? "Arabic" : "Urdu"} voice installed, so I'll show the answer instead of speaking it.`
    );
    handlers.onEnd?.();
    return;
  }

  let level = 0;
  const tick = () => { level = Math.max(0, level - 0.12); handlers.onLevel?.(level); };

  utter.onstart = () => {
    handlers.onStart?.();
    if (decayTimer) clearInterval(decayTimer);
    decayTimer = setInterval(tick, 60);
  };
  utter.onboundary = () => { level = Math.min(1, level + 0.55); handlers.onLevel?.(level); };
  utter.onend = () => { stopDecay(); handlers.onLevel?.(0); handlers.onEnd?.(); };
  utter.onerror = (e) => {
    stopDecay();
    handlers.onLevel?.(0);
    // Cancelling mid-sentence (barge-in) surfaces as an error; that's us.
    if ((e as any).error === "interrupted" || (e as any).error === "canceled") handlers.onEnd?.();
    else { handlers.onError?.("Couldn't read that out."); handlers.onEnd?.(); }
  };

  window.speechSynthesis.speak(utter);
}

function stopDecay() {
  if (decayTimer) { clearInterval(decayTimer); decayTimer = null; }
}

export function cancelSpeech() {
  stopDecay();
  if (ttsSupported()) {
    try { window.speechSynthesis.cancel(); } catch { /* nothing to cancel */ }
  }
}

export function isSpeaking(): boolean {
  return ttsSupported() && window.speechSynthesis.speaking;
}

/**
 * Text destined for a voice. The transcript keeps the original; this strips
 * what a listener would hear as noise — markdown marks, bullet characters and
 * bare ids nobody wants read out digit by digit.
 */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "that record")
    .replace(/\s{2,}/g, " ")
    .trim();
}
