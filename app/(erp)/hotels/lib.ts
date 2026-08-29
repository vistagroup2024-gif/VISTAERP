// Shared hotel-module label maps + helpers (client-safe, no imports).

export const HOTEL_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  confirmed: "Confirmed",
  hcn_received: "HCN Received",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const HOTEL_STATUS_TONE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  processing: "bg-amber-100 text-amber-800",
  confirmed: "bg-blue-100 text-blue-700",
  hcn_received: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export const VENDOR_STATUS_LABEL: Record<string, string> = {
  pending_purchase: "Pending Purchase",
  sent_to_vendor: "Sent to Vendor",
  vendor_processing: "Vendor Processing",
  vendor_confirmed: "Vendor Confirmed",
  hcn_pending: "HCN Pending",
  hcn_received: "HCN Received",
  cancelled: "Cancelled",
  rejected: "Rejected / Unable to Confirm",
};

export const VENDOR_STATUS_TONE: Record<string, string> = {
  pending_purchase: "bg-slate-100 text-slate-600",
  sent_to_vendor: "bg-amber-100 text-amber-800",
  vendor_processing: "bg-amber-100 text-amber-800",
  vendor_confirmed: "bg-blue-100 text-blue-700",
  hcn_pending: "bg-indigo-100 text-indigo-700",
  hcn_received: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
};

export const VENDOR_STATUS_ORDER = [
  "pending_purchase", "sent_to_vendor", "vendor_processing", "vendor_confirmed",
  "hcn_pending", "hcn_received", "cancelled", "rejected",
];

export const HCN_STATUS_LABEL: Record<string, string> = {
  pending: "HCN Pending", received: "HCN Received", shared: "HCN Shared with Client",
  ready_to_send: "HCN Ready to Send", sent: "HCN Sent",
};

// Per-stay HCN workflow (Phase 3): Waiting HCN -> Received (number entered) ->
// Ready to Send -> Sent. `received`/`shared` are legacy values folded into the
// nearest stage so old rows still display sensibly.
export const HCN_STAGE_LABEL: Record<string, string> = {
  pending: "Waiting HCN",
  received: "HCN Ready to Send",
  ready_to_send: "HCN Ready to Send",
  shared: "HCN Sent",
  sent: "HCN Sent",
};

export const HCN_STAGE_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  received: "bg-blue-100 text-blue-700",
  ready_to_send: "bg-blue-100 text-blue-700",
  shared: "bg-green-100 text-green-700",
  sent: "bg-green-100 text-green-700",
};

// Aggregate a booking's per-stay HCN statuses into one headline stage for the
// list: all sent -> Sent; any waiting -> Waiting; otherwise Ready to Send.
export function aggregateHcnStage(statuses: string[]): string {
  if (statuses.length === 0) return "pending";
  const norm = statuses.map((s) => (s === "shared" ? "sent" : s === "received" ? "ready_to_send" : s));
  if (norm.every((s) => s === "sent")) return "sent";
  if (norm.some((s) => s === "pending")) return "pending";
  return "ready_to_send";
}

// Client-shareable HCN text: short guest details + each hotel's stay + HCN.
export function buildHcnCopyText(
  guest: { guest_name: string; booking_no?: string | null; group_no?: string | null; guests?: number | null },
  stays: { hotel: string | null; check_in: string | null; check_out: string | null; hcn: string | null }[],
): string {
  const lines: string[] = [];
  lines.push(`Guest: ${guest.guest_name}`);
  if (guest.group_no) lines.push(`Group: ${guest.group_no}`);
  if (guest.guests) lines.push(`Guests: ${guest.guests}`);
  if (guest.booking_no) lines.push(`Booking: ${guest.booking_no}`);
  lines.push("");
  for (const s of stays) {
    lines.push(`Hotel: ${s.hotel ?? "—"}`);
    lines.push(`Check-in: ${s.check_in ?? "—"}   Check-out: ${s.check_out ?? "—"}`);
    lines.push(`HCN: ${s.hcn || "Pending"}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ---- Per-room pricing (Phase B) ----
// DBL is the base (2 beds, 0 extra). TPL/Quad/Quint add extra beds priced at the
// extra-bed rate. Suite is a flat manual rate.
export const ROOM_TYPES: { value: string; label: string; extra: number }[] = [
  { value: "single", label: "Single", extra: 0 },
  { value: "dbl", label: "Double (DBL)", extra: 0 },
  { value: "tpl", label: "Triple (TPL)", extra: 1 },
  { value: "quad", label: "Quad", extra: 2 },
  { value: "quint", label: "Quint", extra: 3 },
  { value: "suite", label: "Suite (manual)", extra: 0 },
];

export const ROOM_EXTRA: Record<string, number> = Object.fromEntries(ROOM_TYPES.map((r) => [r.value, r.extra]));
export const ROOM_LABEL: Record<string, string> = Object.fromEntries(ROOM_TYPES.map((r) => [r.value, r.label]));

// Summarise a stay's rooms by type for vouchers, e.g. [quad,quad,tpl] -> "2 Quad · 1 Triple (TPL)".
export function roomSummary(rooms: { room_type?: string | null }[]): string {
  const order = ROOM_TYPES.map((r) => r.value);
  const counts = new Map<string, number>();
  for (const r of rooms) { const t = r.room_type || "dbl"; counts.set(t, (counts.get(t) ?? 0) + 1); }
  return Array.from(counts.entries())
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([t, c]) => `${c} ${ROOM_LABEL[t] ?? t}`)
    .join(" · ");
}

export interface RoomRates {
  room_type: string;
  sale_dbl?: number | string; sale_extra?: number | string; sale_suite?: number | string;
  purchase_dbl?: number | string; purchase_extra?: number | string; purchase_suite?: number | string;
}

// Nightly rate for one room (per night), for sale or purchase side. Pricing is now a
// flat per-room rate stored in sale_dbl / purchase_dbl (extra-bed math removed); the
// suite rate is a legacy fallback for older rows.
export function roomNightly(r: RoomRates, side: "sale" | "purchase"): number {
  const flat = Number((side === "sale" ? r.sale_dbl : r.purchase_dbl) || 0);
  if (flat > 0) return flat;
  return Number((side === "sale" ? r.sale_suite : r.purchase_suite) || 0);
}

// Payment status labels for the manual vendor/customer payment states.
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "Pending", partial: "Partial", paid: "Paid", rcvd: "Rcvd",
};
export const PAYMENT_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700", partial: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700", rcvd: "bg-green-100 text-green-700",
};

// Nights: check-in 1 Aug, check-out 5 Aug = 4 nights.
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn + "T00:00:00Z").getTime();
  const b = new Date(checkOut + "T00:00:00Z").getTime();
  const n = Math.round((b - a) / 86400000);
  return n > 0 ? n : 0;
}
