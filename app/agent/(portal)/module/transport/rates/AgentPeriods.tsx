"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { dateStr } from "@/lib/format";

export interface Period { from: string; to: string | null; past: boolean; current: boolean; future: boolean }

// The same period model the office sees on the Rate Master, shown to the agent:
// rates are effective-dated, so a chart is only true for a stretch of time. The
// URL carries the choice, so a period can be linked to and the page stays a
// server render.
export default function AgentPeriods({ periods, on }: { periods: Period[]; on: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const showPast = params.get("past") === "1";
  const shown = showPast ? periods : periods.filter((p) => !p.past);
  const pastCount = periods.filter((p) => p.past).length;
  if (periods.length === 0) return null;

  const go = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    Object.entries(next).forEach(([k, v]) => (v == null ? q.delete(k) : q.set(k, v)));
    router.push(`/agent/module/transport/rates${q.toString() ? `?${q}` : ""}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((p) => (
        <button key={p.from} onClick={() => go({ on: p.from })}
          className={`rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
            on === p.from ? "border-brand bg-brand/10 text-brand"
              : p.past ? "border-slate-200 bg-slate-50 text-slate-500"
              : "border-slate-300 bg-white text-slate-600 hover:border-brand/40"}`}>
          <span className="font-semibold tabular-nums">
            {dateStr(p.from)} → {p.to ? dateStr(p.to) : "onwards"}
          </span>
          <span className={`ml-2 ${p.current ? "text-green-700" : p.future ? "text-amber-600" : "text-slate-400"}`}>
            {p.current ? "current" : p.future ? "upcoming" : "ended"}
          </span>
        </button>
      ))}
      {pastCount > 0 && (
        <button onClick={() => go({ past: showPast ? null : "1" })} className="text-xs text-brand hover:underline">
          {showPast ? "Hide old rates" : `Old rates (${pastCount})`}
        </button>
      )}
    </div>
  );
}
