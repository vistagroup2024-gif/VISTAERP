"use client";

import { useRouter } from "next/navigation";

// Global "back" control shown in the page header. Uses browser history so it
// returns to wherever the user came from; falls back to the provided href.
export default function BackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
    >
      <span aria-hidden className="text-base leading-none">←</span> Back
    </button>
  );
}
