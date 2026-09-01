"use client";

import { useEffect, useRef } from "react";

// ============================================================
// The assistant's presence.
//
// Tier A: a filmed loop of a real person at a desk, when one is supplied, and
// a restrained plate when one is not. `level` (0..1) is the live audio
// amplitude of her speech — it drives a subtle breathing scale, nothing more.
// This is audio-reactive, NOT lip-sync, and it is not dressed up as lip-sync.
//
// Tier B (a streaming photoreal avatar with real phoneme lip-sync) replaces
// the inside of this component and nothing else: the page gives it a state and
// an audio level, and asks nothing about how the face is produced.
//
// Deliberately quiet: no gradients, no glow, no neon ring. This sits inside an
// enterprise ERP, next to a trial balance.
// ============================================================

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

const LABEL: Record<AvatarState, string> = {
  idle: "Online",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

const DOT: Record<AvatarState, string> = {
  idle: "bg-success",
  listening: "bg-info",
  thinking: "bg-warning",
  speaking: "bg-brand-500",
};

export default function AvatarStage({
  state = "idle",
  level = 0,
  src,
  poster,
  compact = false,
}: {
  state?: AvatarState;
  /** Live speech amplitude, 0..1. Wired up in phase 3; 0 until then. */
  level?: number;
  /** Looping video of the assistant. Drop a file in /public and pass its path. */
  src?: string;
  poster?: string;
  compact?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // The loop plays while she is present and pauses when nothing is happening,
  // so an idle tab is not burning a decode loop for no reason.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (state === "idle") v.pause();
    else v.play().catch(() => { /* autoplay refused — the poster still shows */ });
  }, [state]);

  // Breathing on speech. Capped hard: at full volume this is a 1.5% scale,
  // which reads as alive rather than as an animation.
  const scale = 1 + Math.min(Math.max(level, 0), 1) * 0.015;

  return (
    <div className={`panel overflow-hidden ${compact ? "" : "h-full"}`}>
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-slate-100 ${
          compact ? "h-40" : "aspect-[4/5] max-h-[560px]"
        }`}
      >
        {src ? (
          <video
            ref={videoRef}
            className="h-full w-full object-cover transition-transform duration-100"
            style={{ transform: `scale(${scale})` }}
            src={src}
            poster={poster}
            muted
            loop
            playsInline
            preload="metadata"
          />
        ) : (
          <Plate compact={compact} scale={scale} />
        )}

        {/* State chip. Bottom-left, over the image, quiet. */}
        <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${DOT[state]} ${
              state === "listening" || state === "thinking" ? "animate-pulse" : ""
            }`}
          />
          {LABEL[state]}
        </div>
      </div>

      {!compact && (
        <div className="border-t border-slate-100 px-5 py-3.5">
          <div className="text-sm font-semibold text-slate-900">Vista AI</div>
          <div className="text-xs text-slate-500">Vista Group ERP assistant</div>
        </div>
      )}
    </div>
  );
}

// The stand-in until a filmed loop is supplied. A monogram on a warm neutral,
// in the Vista palette — not a drawn face. A cartoon person would be worse
// than no person.
function Plate({ compact, scale }: { compact: boolean; scale: number }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center bg-brand-50 transition-transform duration-100"
      style={{ transform: `scale(${scale})` }}
    >
      <div
        className={`flex items-center justify-center rounded-full bg-white text-brand-700 shadow-card ${
          compact ? "h-16 w-16 text-xl" : "h-28 w-28 text-4xl"
        } font-semibold tracking-tight`}
      >
        V
      </div>
      {!compact && (
        <p className="mt-4 max-w-[16rem] text-center text-xs leading-relaxed text-brand-700/70">
          Add a filmed loop at <span className="font-mono">/public/vista-ai/</span> and pass its
          path to show her here.
        </p>
      )}
    </div>
  );
}
