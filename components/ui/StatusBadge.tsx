// Consistent status pill across the ERP. Maps common status words to the
// design-system semantic badge tones so every module reads the same way.
const MAP: Record<string, string> = {
  // success
  paid: "badge-success", confirmed: "badge-success", completed: "badge-success",
  active: "badge-success", approved: "badge-success", posted: "badge-success",
  received: "badge-success", vendor_confirmed: "badge-success", delivered: "badge-success",
  // warning / in-progress
  pending: "badge-warning", processing: "badge-warning", draft: "badge-neutral",
  partially_paid: "badge-warning", partial: "badge-warning", hold: "badge-warning",
  issued: "badge-info", sent: "badge-info", hcn_pending: "badge-warning",
  // danger
  cancelled: "badge-danger", rejected: "badge-danger", void: "badge-danger",
  overdue: "badge-danger", failed: "badge-danger",
};

export default function StatusBadge({ status }: { status?: string | null }) {
  const key = (status || "").toLowerCase().trim();
  const tone = MAP[key] ?? "badge-neutral";
  const label = (status || "—").replace(/_/g, " ");
  return <span className={`badge ${tone} capitalize`}>{label}</span>;
}
