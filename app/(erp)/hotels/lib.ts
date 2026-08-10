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

export const VENDOR_STATUS_ORDER = [
  "pending_purchase", "sent_to_vendor", "vendor_processing", "vendor_confirmed",
  "hcn_pending", "hcn_received", "cancelled", "rejected",
];

export const HCN_STATUS_LABEL: Record<string, string> = {
  pending: "HCN Pending", received: "HCN Received", shared: "HCN Shared with Client",
};

// Nights: check-in 1 Aug, check-out 5 Aug = 4 nights.
export function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const a = new Date(checkIn + "T00:00:00Z").getTime();
  const b = new Date(checkOut + "T00:00:00Z").getTime();
  const n = Math.round((b - a) / 86400000);
  return n > 0 ? n : 0;
}
