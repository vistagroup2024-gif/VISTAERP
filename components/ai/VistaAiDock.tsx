"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import Conversation, { type ConversationState } from "@/components/ai/Conversation";
import AvatarStage from "@/components/ai/AvatarStage";
import { resolvePageContext } from "@/lib/ai/pageContext";
import Icon from "@/components/ui/Icon";

// ============================================================
// Vista AI, reachable from wherever you already are.
//
// This is what makes "why is this balance so high?" a real question: she
// opens over the screen you are on, and she is told which screen and which
// record — so "this" has a referent without you retyping the customer's name.
//
// She stays open while you navigate; the context follows the route. The
// conversation is the same component the full /ai screen uses, so there is
// one implementation, not two.
//
// Print-hidden and hidden on the login/portal routes, which have their own
// shells and their own sessions.
// ============================================================

export default function VistaAiDock({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ConversationState>("idle");
  const [level, setLevel] = useState(0);

  const pathname = usePathname();
  const search = useSearchParams();

  const page = useMemo(() => resolvePageContext(pathname ?? "", search), [pathname, search]);

  const onState = useCallback((s: ConversationState, l: number) => { setState(s); setLevel(l); }, []);

  // Escape closes, unless she is mid-sentence — then the Stop button is the
  // thing to reach for and closing under her would be confusing.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // She has her own screen; there is no sense floating over it.
  if (pathname === "/ai" || pathname?.startsWith("/ai/")) return null;

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Vista AI"
          title="Vista AI"
          className="no-print fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white shadow-pop transition-colors hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <Icon name="assistant" size={22} />
        </button>
      )}

      {open && (
        <>
          {/* Backdrop on mobile only: on desktop the ERP stays usable beside her. */}
          <div
            className="no-print fixed inset-0 z-40 bg-slate-900/20 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          <aside
            role="dialog"
            aria-label="Vista AI"
            className="no-print fixed inset-x-0 bottom-0 z-50 flex h-[85vh] flex-col rounded-t-xl border border-slate-200 bg-white shadow-pop
                       sm:inset-x-auto sm:right-4 sm:bottom-4 sm:h-[min(38rem,calc(100vh-3rem))] sm:w-[24rem] sm:rounded-xl lg:w-[26rem]"
          >
            <header className="flex items-center gap-3 border-b border-slate-200 px-3 py-2.5">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full">
                <AvatarStage state={state} level={level} compact bare />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">Vista AI</div>
                <div className="truncate text-[11px] text-slate-500">
                  {state === "listening" ? "Listening"
                    : state === "thinking" ? "Thinking"
                    : state === "speaking" ? "Speaking"
                    : page?.screen ?? "Online"}
                </div>
              </div>
              <Link
                href="/ai"
                title="Open the full screen"
                aria-label="Open the full Vista AI screen"
                className="btn-ghost btn-sm"
              >
                <Icon name="external" size={15} />
              </Link>
              <button onClick={() => setOpen(false)} aria-label="Close" className="btn-ghost btn-sm">
                <Icon name="close" size={16} />
              </button>
            </header>

            <Conversation configured={configured} page={page} onState={onState} compact />
          </aside>
        </>
      )}
    </>
  );
}
