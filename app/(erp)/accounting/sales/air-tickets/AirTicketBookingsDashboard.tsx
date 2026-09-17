"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/PageHeader";
import { money, dateTimeStr } from "@/lib/format";

type Booking = {
  id: string; doc_no: string; doc_date: string; party_name: string | null;
  total: number; currency: string; hold_expires_at: string | null;
  status: "held" | "issued" | "expired" | "cancelled";
  hours_left: number | null;
};

const STATUS_LABEL: Record<Booking["status"], string> = {
  held: "Held", issued: "Issued", expired: "Expired", cancelled: "Cancelled",
};
const STATUS_TONE: Record<Booking["status"], string> = {
  held: "bg-amber-100 text-amber-800",
  issued: "bg-emerald-100 text-emerald-700",
  expired: "bg-red-100 text-red-700",
  cancelled: "bg-slate-200 text-slate-500",
};

const TABS = ["held", "issued", "expired", "cancelled", "all"] as const;
type Tab = typeof TABS[number];

// The airline holds a fare for a few hours or days and releases it on its own
// if nobody issues it — this is the worklist that lets staff catch that
// before it happens, not after. Held is the default tab because it's the one
// that needs a human decision; everything else is already settled.
export default function AirTicketBookingsDashboard({ canCreate }: { canCreate: boolean }) {
  const supabase = createClient();
  const [rows, setRows] = useState<Booking[]>([]);
  const [tab, setTab] = useState<Tab>("held");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("air_ticket_bookings_list");
      setRows(((data ?? []) as Booking[]));
      setLoading(false);
    })();
  }, [supabase]);

  const counts = useMemo(() => {
    const c: Record<Booking["status"], number> = { held: 0, issued: 0, expired: 0, cancelled: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const list = tab === "all" ? rows : rows.filter((r) => r.status === tab);
    // Soonest-expiring held booking first — that is the one to act on.
    return [...list].sort((a, b) => (a.hours_left ?? Infinity) - (b.hours_left ?? Infinity));
  }, [rows, tab]);

  return (
    <div>
      <PageHeader title="Air Ticket Bookings"
        action={canCreate ? { href: "/accounting/sales/air-tickets?id=new", label: "New Booking" } : undefined} />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-sm ${tab === t ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {t === "all" ? "All" : STATUS_LABEL[t]}{t !== "all" && ` (${counts[t]})`}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Booking</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-right">Fare</th>
              <th className="px-3 py-2 text-left">Hold Expires</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1.5">
                  <Link href={`/accounting/sales/air-tickets?id=${r.id}`} className="font-medium text-brand hover:underline">{r.doc_no}</Link>
                </td>
                <td className="px-3 py-1.5">{r.party_name ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.total, r.currency)}</td>
                <td className="px-3 py-1.5">
                  {r.hold_expires_at ? dateTimeStr(r.hold_expires_at) : "—"}
                  {r.status === "held" && r.hours_left !== null && (
                    <span className={`ml-2 text-xs ${r.hours_left <= 6 ? "font-semibold text-red-600" : r.hours_left <= 24 ? "text-amber-600" : "text-slate-400"}`}>
                      {r.hours_left <= 0 ? "overdue" : `${Math.round(r.hours_left)}h left`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={5}>
                {tab === "held" ? "No holds waiting on a decision." : `No ${tab === "all" ? "" : STATUS_LABEL[tab as Booking["status"]].toLowerCase() + " "}bookings.`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
