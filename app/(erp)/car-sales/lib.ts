// Shared Car Sales module label maps + helpers (client-safe).
import { money } from "@/lib/format";

export const VEHICLE_STATUS_LABEL: Record<string, string> = {
  ordered: "Ordered",
  in_stock: "In Stock",
  reserved: "Reserved",
  sold: "Sold",
  delivered: "Delivered",
  held: "Held by Vista",
  cancelled: "Cancelled",
};

export const VEHICLE_STATUS_TONE: Record<string, string> = {
  ordered: "bg-slate-100 text-slate-600",
  in_stock: "bg-emerald-100 text-emerald-700",
  reserved: "bg-amber-100 text-amber-800",
  sold: "bg-blue-100 text-blue-700",
  delivered: "bg-indigo-100 text-indigo-700",
  held: "bg-red-100 text-red-700",
  cancelled: "bg-slate-200 text-slate-500",
};

export const VEHICLE_STATUSES = ["ordered", "in_stock", "reserved", "sold", "delivered", "held", "cancelled"];

export const OWNERSHIP_LABEL: Record<string, string> = { vista: "Vista-owned", transferred: "Transferred" };
export const OWNERSHIP_TONE: Record<string, string> = {
  vista: "bg-slate-100 text-slate-600",
  transferred: "bg-green-100 text-green-700",
};

// All module money is SAR.
export const sar = (n: number | string | null | undefined) => money(Number(n || 0), "SAR");
export const vehicleTitle = (v: { make?: string | null; model?: string | null; variant?: string | null; model_year?: number | null }) =>
  [v.make, v.model, v.variant, v.model_year ? `(${v.model_year})` : null].filter(Boolean).join(" ") || "—";
