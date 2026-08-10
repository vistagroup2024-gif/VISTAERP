"use client";

import { useState } from "react";
import Link from "next/link";
import { dateStr, fmtTime12 } from "@/lib/format";

export interface Trip {
  trip_id: string; booking_id: string; booking_no: string | null; passenger_name: string | null;
  group_no: string | null; pax: number | null; mobile: string | null;
  route: string | null; trip_date: string | null; trip_time: string | null; status: string;
  vehicle: string | null; requested_vehicle: string | null; is_upgraded: boolean;
  flight_no: string | null; pickup: string | null; drop: string | null;
  driver_name: string | null; driver_mobile: string | null; driver_reg: string | null;
  is_arrival: boolean; is_departure: boolean;
}

// Agent-facing status: agents don't care whether Vista fulfils in-house or by an
// outsourced vendor — only whether a driver is confirmed yet.
export function agentStatus(t: Trip): { label: string; cls: string } {
  if (t.status === "completed") return { label: "Completed", cls: "bg-green-100 text-green-700" };
  const assigned = !!t.driver_name || ["assigned", "on_route", "picked_up"].includes(t.status);
  return assigned
    ? { label: "Driver Assigned", cls: "bg-indigo-100 text-indigo-700" }
    : { label: "Pending Assignment", cls: "bg-amber-100 text-amber-700" };
}

function CopyBtn({ label, text }: { label: string; text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {} }}
      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
      {done ? "✓ Copied" : label}
    </button>
  );
}

export default function ScheduleTripCard({ t }: { t: Trip }) {
  const st = agentStatus(t);
  const when = `${dateStr(t.trip_date)}${t.trip_time ? ` · ${fmtTime12(t.trip_time)}` : ""}`;
  // Same format as the admin "Copy Driver Details" (WhatsApp-style).
  const driverText = [
    `Haji Name : ${t.passenger_name ?? "—"}`,
    `Route : ${t.route ?? "—"}`,
    `Trip Date : ${t.trip_date ?? "—"}`,
    ``,
    `*Driver Details*`,
    `Name : ${t.driver_name ?? "—"}`,
    `Number : ${t.driver_mobile ?? "—"}`,
    `Vehicle : ${t.vehicle ?? t.requested_vehicle ?? "—"}`,
    `Car Reg No : ${t.driver_reg ?? "—"}`,
  ].join("\n");
  const hasDriver = !!t.driver_name;

  return (
    <div className="rounded-lg border border-slate-100 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">{t.route ?? "—"}</div>
          <div className="text-xs text-slate-500">
            {t.passenger_name ?? "—"}{t.pax ? ` · ${t.pax} pax` : ""}{t.group_no ? ` · Group ${t.group_no}` : ""}{t.booking_no ? ` · ${t.booking_no}` : ""}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-600">
        <span>📅 {when}</span>
        {t.flight_no && <span>✈️ {t.flight_no}</span>}
        <span className="col-span-2">🚐 {t.is_upgraded
          ? <>Requested <span className="line-through text-slate-400">{t.requested_vehicle ?? "—"}</span> → <span className="font-medium text-slate-700">{t.vehicle ?? "—"}</span> <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">upgraded</span></>
          : <>{t.vehicle ?? t.requested_vehicle ?? <span className="text-slate-400">vehicle pending</span>}</>}
        </span>
        <span className="col-span-2">🧑‍✈️ {t.driver_name
          ? <>{t.driver_name}{t.driver_mobile ? ` · ${t.driver_mobile}` : ""}</>
          : <span className="text-slate-400">driver pending</span>}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {hasDriver && <CopyBtn label="Copy driver details" text={driverText} />}
        <Link href={`/agent/module/transport/${t.booking_id}`} className="rounded border border-brand/30 bg-brand/5 px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10">View booking →</Link>
      </div>
    </div>
  );
}
