"use client";

import { useState } from "react";

// The Driver Tafweej Details, as the tafweej asks for them. This draws what
// trip_tafweej_details() returns and never shapes the text itself: staff and
// agent see the same block because it is built once, in the database, and
// handed to both — the same rule this project applies to the agent fare chart.
export type TafweejDetails = {
  trip_id: string; booking_id: string;
  company: string; driver_name: string | null; reg_no: string | null;
  reg_missing: boolean; is_vendor: boolean; confirmed: boolean;
  tafweej_created: boolean; ready: boolean; text: string | null;
};

export function CopyTafweejButton({ text, label = "Copy Tafweej details", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}
      className={className ?? "btn text-sm"}>
      {done ? "✓ Copied" : label}
    </button>
  );
}

export default function TafweejCard({ d, title, notReadyText }: { d: TafweejDetails; title?: string; notReadyText?: string }) {
  if (!d.ready || !d.text) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        {notReadyText ?? (d.driver_name || d.confirmed ? "Driver details are not ready yet." : "No driver has been assigned to this trip yet.")}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {title && <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>}
      <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-800">{d.text}</pre>
      {d.reg_missing && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
          The registration number is not on file for this driver — the Reg No. line is blank until it is added.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <CopyTafweejButton text={d.text} />
        {d.tafweej_created && <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">Tafweej created ✓</span>}
      </div>
    </div>
  );
}
