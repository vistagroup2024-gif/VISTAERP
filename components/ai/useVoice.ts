"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listen, speak, cancelSpeech, forSpeech, speechUnavailableReason,
  type Listener, type VoiceLang,
} from "@/lib/ai/voice";

// ============================================================
// The conversational half of the voice layer: when to submit what was said,
// and what to do when the user talks over her.
//
// Press-to-talk: hold the mic on, speak, press again. The phrase is submitted
// when you stop.
//
// Hands-free: recognition stays on. A phrase is submitted after a short
// silence, so a natural pause ends the sentence instead of a button press.
// While she is speaking, hearing the user cancels her mid-sentence and the
// in-flight answer is dropped — that is the barge-in in requirement §5.
//
// One honest caveat, surfaced in the UI rather than buried: on speakers, the
// microphone can hear her own voice. Barge-in therefore ignores anything
// shorter than a few characters while she is talking, which cuts the false
// triggers without needing a headset. A headset removes the problem entirely.
// ============================================================

const SILENCE_MS = 1100;      // pause that ends a hands-free phrase
const BARGE_IN_MIN_CHARS = 4; // ignore her own voice bleeding into the mic

export interface UseVoiceOptions {
  language: VoiceLang;
  handsFree: boolean;
  /** A settled phrase ready to send. */
  onPhrase(text: string): void;
  /** The user talked over her — stop the answer in flight. */
  onBargeIn(): void;
}

export function useVoice({ language, handsFree, onPhrase, onBargeIn }: UseVoiceOptions) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listener = useRef<Listener | null>(null);
  const buffer = useRef("");
  const silence = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingRef = useRef(false);

  // Handlers change every render; refs keep the live ones reachable from the
  // recognition callbacks without tearing down and restarting the microphone.
  const onPhraseRef = useRef(onPhrase);
  const onBargeInRef = useRef(onBargeIn);
  useEffect(() => { onPhraseRef.current = onPhrase; }, [onPhrase]);
  useEffect(() => { onBargeInRef.current = onBargeIn; }, [onBargeIn]);

  const clearSilence = () => {
    if (silence.current) { clearTimeout(silence.current); silence.current = null; }
  };

  const flush = useCallback(() => {
    clearSilence();
    const text = buffer.current.trim();
    buffer.current = "";
    setInterim("");
    if (text) onPhraseRef.current(text);
  }, []);

  const stopListening = useCallback((submit: boolean) => {
    // Discarding clears the buffer first: stop() makes the browser fire onEnd
    // a moment later, and that handler submits whatever is buffered.
    if (!submit) { clearSilence(); buffer.current = ""; setInterim(""); }
    listener.current?.stop();
    listener.current = null;
    setListening(false);
    if (submit) flush();
  }, [flush]);

  const startListening = useCallback(() => {
    const reason = speechUnavailableReason();
    if (reason) { setError(reason); return; }

    setError(null);
    buffer.current = "";
    setInterim("");

    const l = listen(language, {
      onInterim(text) {
        setInterim(text);
        // Someone talking over her is an interruption, not a question yet.
        if (speakingRef.current && text.trim().length >= BARGE_IN_MIN_CHARS) {
          cancelSpeech();
          speakingRef.current = false;
          setSpeaking(false);
          setLevel(0);
          onBargeInRef.current();
        }
      },
      onFinal(text) {
        buffer.current = (buffer.current + " " + text).trim();
        setInterim("");
        if (handsFree) {
          // A pause, not a button, ends the sentence.
          clearSilence();
          silence.current = setTimeout(flush, SILENCE_MS);
        }
      },
      onError(message) {
        setError(message);
        setListening(false);
        listener.current = null;
      },
      onEnd() {
        setListening(false);
        listener.current = null;
        if (!handsFree) {
          // Press-to-talk: the browser ends the session itself after a pause,
          // and that is the natural end of the sentence. Send it. Without
          // this the phrase is captured and dropped, which looks exactly like
          // she heard you and decided not to answer.
          if (buffer.current.trim()) flush();
          else setError("I didn't catch that — try again, a little closer to the microphone.");
        }
      },
    }, handsFree);

    if (l) { listener.current = l; setListening(true); }
  }, [language, handsFree, flush]);

  const toggleListening = useCallback(() => {
    if (listening) stopListening(true);
    else startListening();
  }, [listening, startListening, stopListening]);

  const say = useCallback(async (text: string) => {
    const body = forSpeech(text);
    if (!body) return;
    speakingRef.current = true;
    setSpeaking(true);
    await speak(body, language, {
      onLevel: setLevel,
      onEnd() { speakingRef.current = false; setSpeaking(false); setLevel(0); },
      onError(message) { setError(message); },
    });
  }, [language]);

  const hush = useCallback(() => {
    cancelSpeech();
    speakingRef.current = false;
    setSpeaking(false);
    setLevel(0);
  }, []);

  // Hands-free follows the switch: turning it on opens the microphone, turning
  // it off closes it. Leaving a hot mic behind a flipped switch would be rude.
  useEffect(() => {
    if (handsFree && !listening) startListening();
    if (!handsFree && listening) stopListening(false);
    // Only react to the switch itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree]);

  // Never leave the microphone or a half-read sentence running on unmount.
  useEffect(() => () => {
    buffer.current = "";          // so the abort below cannot submit anything
    listener.current?.abort();
    clearSilence();
    cancelSpeech();
  }, []);

  return {
    listening, interim, level, speaking, error,
    startListening, stopListening, toggleListening,
    say, hush,
    clearError: () => setError(null),
  };
}
