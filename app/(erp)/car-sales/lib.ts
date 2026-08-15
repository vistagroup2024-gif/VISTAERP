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

export const PO_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", ordered: "Ordered", received: "Received", cancelled: "Cancelled",
};
export const PO_STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  ordered: "bg-amber-100 text-amber-800",
  received: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", active: "Active", completed: "Completed", cancelled: "Cancelled",
};
export const CONTRACT_STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  active: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
};

export const INST_STATUS_LABEL: Record<string, string> = {
  pending: "Pending", partial: "Partially Paid", paid: "Paid",
  overdue: "Overdue", overdue_partial: "Overdue (Partial)",
};
export const INST_STATUS_TONE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  partial: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-red-100 text-red-700",
  overdue_partial: "bg-red-100 text-red-700",
};

// Derived installment status (mirrors car_installment_status in SQL). No penalties.
export function instStatus(amount: number, paid: number, due: string | null): string {
  const a = Number(amount || 0), p = Number(paid || 0);
  const overdue = !!due && due < new Date().toISOString().slice(0, 10);
  if (p >= a && a > 0) return "paid";
  if (p > 0 && p < a) return overdue ? "overdue_partial" : "partial";
  if (overdue) return "overdue";
  return "pending";
}

// All module money is SAR.
export const sar = (n: number | string | null | undefined) => money(Number(n || 0), "SAR");
export const vehicleTitle = (v: { make?: string | null; model?: string | null; variant?: string | null; model_year?: number | null }) =>
  [v.make, v.model, v.variant, v.model_year ? `(${v.model_year})` : null].filter(Boolean).join(" ") || "—";
