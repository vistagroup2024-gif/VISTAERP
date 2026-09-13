"use client";

import Link from "next/link";
import { useTripAlertRpc } from "@/components/transport/TripAlerts";

// The header's red pill: how many trips are sitting in the wrong status right
// now. Same source as the banner (transport_trip_alert_summary over
// transport_trip_alerts), so the two cannot disagree. Nothing is drawn when
// the count is zero — an alert that is always there is not an alert.
export default function TripAlertBadge() {
  const { data } = useTripAlertRpc<{ total: number; not_picked_up: number; not_completed: number }>("transport_trip_alert_summary");
  const total = Number(data?.total) || 0;
  if (!total) return null;
  const title = `${total} trip alert${total === 1 ? "" : "s"}: ${data!.not_picked_up} pickup not recorded, ${data!.not_completed} not completed. Open Transport → Operations.`;
  return (
    <Link href="/transport/operations#trip-alerts" prefetch={false} title={title} aria-label={title}
      className="flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white shadow-sm hover:bg-red-700">
      <span aria-hidden>⚠</span>
      <span className="tabular-nums">{total}</span>
    </Link>
  );
}
