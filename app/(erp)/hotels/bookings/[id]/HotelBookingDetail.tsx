"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr, money } from "@/lib/format";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import {
  HOTEL_STATUS_LABEL, HOTEL_STATUS_TONE, VENDOR_STATUS_LABEL, VENDOR_STATUS_ORDER,
  HCN_STAGE_LABEL, HCN_STAGE_TONE, buildHcnCopyText,
  ROOM_LABEL, roomNightly,
} from "../../lib";

interface Perms {
  canEdit: boolean; canPurchase: boolean; canPurchaseRate: boolean; canProfit: boolean;
  canHcn: boolean; canCancel: boolean; canPayable: boolean; canVoucher: boolean; canSupplier: boolean;
}
interface Opt { id: string; name: string }

export default function HotelBookingDetail({
  booking, stays, suppliers, hotels, perms, timeline,
}: {
  booking: any; stays: any[]; suppliers: Opt[]; hotels: Opt[]; perms: Perms; timeline: any[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rpc(fn: string, args: any) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    router.refresh();
    return true;
  }

  const st = booking.status as string;
  const saleTotal = stays.reduce((a, s) => a + (Number(s.sale_total) || 0), 0);
  const purchTotal = stays.reduce((a, s) => a + (Number(s.purchase_total) || 0), 0);
  const profit = saleTotal - purchTotal;
  const margin = saleTotal > 0 ? (profit / saleTotal) * 100 : 0;

  // ---- Cancel ----
  const [showCancel, setShowCancel] = useState<null | "sales" | "supplier">(null);
  const [cf, setCf] = useState({ reason: "", supplier_cancel_status: "", supplier_charges: "", client_refund: "", notes: "" });

  return (
    <div className="space-y-6">
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      {/* Header + lifecycle actions */}
      <div className="card flex flex-wrap items-center gap-3">
        <span className={`badge ${HOTEL_STATUS_TONE[st] ?? "bg-slate-100"}`}>{HOTEL_STATUS_LABEL[st] ?? st}</span>
        <span className="text-sm text-slate-400">{stays.length} stay{stays.length === 1 ? "" : "s"}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {perms.canEdit && st !== "cancelled" && <Link href={`/hotels/bookings/${booking.id}/edit`} className="btn-outline text-sm">Edit</Link>}
          {perms.canVoucher && <Link href={`/hotels/bookings/${booking.id}/voucher`} className="btn-outline text-sm">Voucher</Link>}
          {!booking.checked_in_at && st !== "cancelled" && perms.canEdit &&
            <button disabled={busy} className="btn-outline text-sm" onClick={() => rpc("hotel_booking_checkin", { p_id: booking.id })}>Mark Check-in</button>}
          {booking.checked_in_at && !booking.checked_out_at && perms.canEdit &&
            <button disabled={busy} className="btn-outline text-sm" onClick={() => rpc("hotel_booking_checkout", { p_id: booking.id })}>Mark Check-out</button>}
          {perms.canCancel && st !== "cancelled" &&
            <button className="btn-outline text-sm text-red-600" onClick={() => setShowCancel("sales")}>Cancel</button>}
          {perms.canCancel && st === "cancelled" &&
            <button disabled={busy} className="btn-outline text-sm text-red-600"
              onClick={async () => { if (confirm("Delete this cancelled booking permanently? This cannot be undone.")) { const ok = await rpc("hotel_booking_delete", { p_id: booking.id }); if (ok) { router.push("/hotels/bookings"); } } }}>
              Delete
            </button>}
        </div>
      </div>

      {/* Guest + totals */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Guest Details</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Dt l="Guest / Group" v={booking.guest_name} />
            <Dt l="Agent" v={booking.agent_name} />
            <Dt l="Mobile" v={booking.mobile} />
            <Dt l="WhatsApp" v={booking.whatsapp} />
            <Dt l="Nationality" v={booking.nationality} />
            <Dt l="Guests" v={String(booking.guests ?? "—")} />
            <Dt l="Managed By" v={booking.managed_by} />
            <Dt l="Source" v={booking.source} />
          </dl>
          {booking.hotel_requirements && <p className="mt-2 text-sm text-slate-500">🏨 {booking.hotel_requirements}</p>}
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Totals</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Grand Sale Total</span><b>{money(saleTotal, "SAR")}</b></div>
            {perms.canProfit && (
              <>
                <div className="flex justify-between"><span className="text-slate-400">Grand Purchase Total</span><b>{money(purchTotal, "SAR")}</b></div>
                <div className="flex justify-between"><span className="text-slate-400">Gross Profit</span><b className={profit >= 0 ? "text-green-700" : "text-red-600"}>{money(profit, "SAR")} ({margin.toFixed(1)}%)</b></div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Stays */}
      <div className="space-y-4">
        <h2 className="font-semibold text-slate-700">Hotel Stays</h2>
        {stays.map((stay, i) => (
          <StayCard key={stay.id} stay={stay} index={i} booking={booking} suppliers={suppliers} hotels={hotels} perms={perms} rpc={rpc} busy={busy} />
        ))}
        {stays.length === 0 && <p className="card text-sm text-slate-400">No stays yet — use Edit to add hotel stays.</p>}
      </div>

      {/* Documents */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-slate-700">Documents</h2>
        <AttachmentsPanel endpoint="/api/hotel/attachments" groupId={booking.id} canUpload={perms.canEdit} canDelete={perms.canEdit} />
      </section>

      {/* Timeline */}
      <section className="card">
        <h2 className="mb-3 font-semibold text-slate-700">Booking Timeline</h2>
        <ul className="space-y-2 text-sm">
          {timeline.map((t) => (
            <li key={t.id} className="flex gap-3 border-b border-slate-50 pb-2">
              <span className="w-32 shrink-0 text-slate-400">{new Date(t.created_at).toLocaleString()}</span>
              <span className="font-medium">{t.action.replace(/^hotel_/, "").replace(/_/g, " ")}</span>
              <span className="text-slate-500">{t.detail && Object.keys(t.detail).length ? JSON.stringify(t.detail) : ""}</span>
            </li>
          ))}
          {timeline.length === 0 && <li className="text-slate-400">No history yet.</li>}
        </ul>
      </section>

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCancel(null)}>
          <div className="w-full max-w-lg rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Cancel Booking</h3>
            <div className="mb-3 flex gap-2 text-sm">
              <button className={`badge ${showCancel === "sales" ? "bg-brand text-white" : "bg-slate-100"}`} onClick={() => setShowCancel("sales")}>Sales Cancellation</button>
              <button className={`badge ${showCancel === "supplier" ? "bg-brand text-white" : "bg-slate-100"}`} onClick={() => setShowCancel("supplier")}>Supplier Cancellation</button>
            </div>
            <div className="space-y-3">
              <div><label className="label">Reason</label><input className="input" value={cf.reason} onChange={(e) => setCf({ ...cf, reason: e.target.value })} /></div>
              {showCancel === "supplier" && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Supplier Cancel Status</label><input className="input" value={cf.supplier_cancel_status} onChange={(e) => setCf({ ...cf, supplier_cancel_status: e.target.value })} /></div>
                  <div><label className="label">Supplier Charges</label><input type="number" className="input" value={cf.supplier_charges} onChange={(e) => setCf({ ...cf, supplier_charges: e.target.value })} /></div>
                </div>
              )}
              <div><label className="label">Client Refund</label><input type="number" className="input" value={cf.client_refund} onChange={(e) => setCf({ ...cf, client_refund: e.target.value })} /></div>
              <div><label className="label">Internal Notes</label><textarea className="input" rows={2} value={cf.notes} onChange={(e) => setCf({ ...cf, notes: e.target.value })} /></div>
            </div>
            <div className="mt-4 flex gap-2">
              <button disabled={busy} className="btn bg-red-600" onClick={async () => { const ok = await rpc("hotel_cancel", { p_booking: booking.id, p_type: showCancel, p: cf }); if (ok) setShowCancel(null); }}>Confirm {showCancel} cancellation</button>
              <button className="btn-outline" onClick={() => setShowCancel(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StayCard({ stay, index, booking, suppliers, hotels, perms, rpc, busy }: {
  stay: any; index: number; booking: any; suppliers: Opt[]; hotels: Opt[]; perms: Perms;
  rpc: (fn: string, args: any) => Promise<boolean>; busy: boolean;
}) {
  const [pf, setPf] = useState({
    supplier_id: stay.supplier_id ?? "",
    hotel_id: stay.hotel_id ?? "",
    hotel_name: stay.hotel_name ?? "",
    city: stay.city ?? "",
    room_type: stay.room_type ?? "",
    meal_plan: stay.meal_plan ?? "",
    check_in: stay.check_in ?? "",
    check_out: stay.check_out ?? "",
    rooms: stay.rooms ?? 1,
    sale_rate: stay.sale_rate ?? "",
    sale_total: stay.sale_total ?? "",
    purchase_rate: stay.purchase_rate ?? "",
    purchase_total: stay.purchase_total ?? "",
    currency: stay.currency ?? "SAR",
    supplier_ref: stay.supplier_ref ?? "",
    notes: stay.notes ?? "",
    option_date: stay.option_date ?? "",
    vendor_option_date: stay.vendor_option_date ?? "",
  });
  const setP = (k: string, v: any) => setPf((s) => ({ ...s, [k]: v }));
  const [showHcn, setShowHcn] = useState(false);
  const [hcnNo, setHcnNo] = useState(stay.hcn ?? "");
  const [copied, setCopied] = useState(false);

  const stage = String(stay.hcn_status ?? "pending");
  const hotelName = hotels.find((h) => h.id === stay.hotel_id)?.name ?? stay.hotel_name ?? "—";

  async function copyHcn() {
    const text = buildHcnCopyText(
      { guest_name: booking.guest_name, booking_no: booking.booking_no, group_no: booking.group_no, guests: booking.guests },
      [{ hotel: hotelName, check_in: stay.check_in, check_out: stay.check_out, hcn: stay.hcn }],
    );
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }

  return (
    <section className="card space-y-4 border-l-4 border-brand/60">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold text-slate-700">Stay {index + 1} · {hotelName}</h3>
        <span className="badge bg-slate-100 capitalize text-slate-600">{stay.city ?? ""}</span>
        <span className={`badge ${HCN_STAGE_TONE[stage] ?? "bg-slate-100"}`}>{HCN_STAGE_LABEL[stage] ?? stage}</span>
        {stay.vendor_status && <span className="badge bg-slate-100 text-slate-600">{VENDOR_STATUS_LABEL[stay.vendor_status] ?? stay.vendor_status}</span>}
      </div>

      <dl className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
        <Dt l="Check-in" v={dateStr(stay.check_in)} />
        <Dt l="Check-out" v={dateStr(stay.check_out)} />
        <Dt l="Nights" v={String(stay.nights ?? "—")} />
        <Dt l="Rooms" v={String(stay.rooms ?? "—")} />
        <Dt l="Option Date (customer)" v={dateStr(stay.option_date)} />
        <Dt l="Vendor Option Date" v={dateStr(stay.vendor_option_date)} />
        <Dt l="Sale Total" v={money(Number(stay.sale_total) || 0, "SAR")} />
        {perms.canProfit && <Dt l="Purchase Total" v={money(Number(stay.purchase_total) || 0, "SAR")} />}
      </dl>

      {/* Per-room breakdown */}
      {Array.isArray(stay.rooms_detail) && stay.rooms_detail.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs text-slate-400"><tr>
              <th className="py-1">Room</th><th className="py-1">Meal</th><th className="py-1 text-right">Sale/night</th>
              {perms.canProfit && <th className="py-1 text-right">Purchase/night</th>}
            </tr></thead>
            <tbody>
              {stay.rooms_detail.map((r: any, ri: number) => (
                <tr key={r.id ?? ri} className="border-t border-slate-50">
                  <td className="py-1">{ROOM_LABEL[r.room_type] ?? r.room_type}{r.room_type === "suite" && r.suite_type ? ` · ${r.suite_type}` : ""}</td>
                  <td className="py-1 text-slate-500">{r.meal_plan || "—"}</td>
                  <td className="py-1 text-right">{money(roomNightly(r, "sale"), "SAR")}</td>
                  {perms.canProfit && <td className="py-1 text-right text-slate-500">{money(roomNightly(r, "purchase"), "SAR")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Purchase / vendor edit */}
      {perms.canPurchase && (
        <div className="rounded-md bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Purchase / Vendor</span>
            <select className="input max-w-xs" disabled={busy} value={stay.vendor_status}
              onChange={(e) => rpc("hotel_purchase_set_vendor_status", { p_id: stay.id, p_status: e.target.value, p_note: null })}>
              {VENDOR_STATUS_ORDER.map((s) => <option key={s} value={s}>{VENDOR_STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {perms.canSupplier && (
              <div><label className="label">Vendor / Supplier</label>
                <select className="input" value={pf.supplier_id} onChange={(e) => setP("supplier_id", e.target.value)}>
                  <option value="">— Select —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {perms.canPurchaseRate && <div><label className="label">Purchase Total <span className="text-slate-400">(set per room in Edit)</span></label><input className="input bg-slate-50" value={money(Number(stay.purchase_total) || 0, "SAR")} readOnly tabIndex={-1} /></div>}
            <div><label className="label">Supplier Reference</label><input className="input" value={pf.supplier_ref} onChange={(e) => setP("supplier_ref", e.target.value)} /></div>
            <div><label className="label">Vendor Option Date <span className="text-slate-400">(vendor due)</span></label><input type="date" className="input" value={pf.vendor_option_date} onChange={(e) => setP("vendor_option_date", e.target.value)} /></div>
            <div><label className="label">Option Date <span className="text-slate-400">(customer due)</span></label><input type="date" className="input" value={pf.option_date} onChange={(e) => setP("option_date", e.target.value)} /></div>
            <div className="md:col-span-3"><label className="label">Booking Notes</label><input className="input" value={pf.notes} onChange={(e) => setP("notes", e.target.value)} /></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={busy} className="btn" onClick={() => rpc("hotel_purchase_save", { p_id: stay.id, p_booking: booking.id, p: { supplier_id: pf.supplier_id, supplier_ref: pf.supplier_ref, notes: pf.notes, option_date: pf.option_date, vendor_option_date: pf.vendor_option_date } })}>Save vendor / dates</button>
            {perms.canPayable && !stay.bill_id &&
              <button disabled={busy} className="btn-outline" onClick={() => rpc("hotel_purchase_post_payable", { p_id: stay.id })}>Post Supplier Payable</button>}
            {stay.bill_id && <Link href={`/purchase/bills/${stay.bill_id}`} className="btn-outline">View Payable →</Link>}
          </div>
        </div>
      )}

      {/* HCN workflow */}
      {perms.canHcn && (
        <div className="rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">HCN</span>
            <span className={`badge ${HCN_STAGE_TONE[stage] ?? "bg-slate-100"}`}>{HCN_STAGE_LABEL[stage] ?? stage}</span>
            {stay.hcn && <span className="font-mono text-sm">{stay.hcn}</span>}
            <div className="ml-auto flex flex-wrap gap-2">
              {stage === "pending" && <button disabled={busy} className="btn text-sm" onClick={() => { setHcnNo(stay.hcn ?? ""); setShowHcn(true); }}>Received HCN</button>}
              {(stage === "ready_to_send" || stage === "received") &&
                <button disabled={busy} className="btn text-sm" onClick={() => rpc("hotel_hcn_mark_sent", { p_id: stay.id })}>Mark HCN Sent</button>}
              {(stage === "ready_to_send" || stage === "received") &&
                <button disabled={busy} className="btn-outline text-sm" onClick={() => { setHcnNo(stay.hcn ?? ""); setShowHcn(true); }}>Edit HCN</button>}
              {stay.hcn && <button className="btn-outline text-sm" onClick={copyHcn}>{copied ? "Copied ✓" : "Copy HCN"}</button>}
            </div>
          </div>
          {stay.hcn_shared_at && <p className="mt-2 text-xs text-green-700">✓ Sent {dateStr(stay.hcn_shared_at)}{stay.hcn_shared_by ? ` by ${stay.hcn_shared_by}` : ""}</p>}
        </div>
      )}

      {/* Received-HCN modal */}
      {showHcn && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowHcn(false)}>
          <div className="w-full max-w-sm rounded-lg bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-semibold">Enter HCN number</h3>
            <p className="mb-2 text-xs text-slate-500">{hotelName} · {dateStr(stay.check_in)} → {dateStr(stay.check_out)}</p>
            <input autoFocus className="input" value={hcnNo} onChange={(e) => setHcnNo(e.target.value)} placeholder="Hotel Confirmation Number" />
            <div className="mt-4 flex gap-2">
              <button disabled={busy || !hcnNo.trim()} className="btn" onClick={async () => { const ok = await rpc("hotel_hcn_set_number", { p_id: stay.id, p_hcn: hcnNo.trim() }); if (ok) setShowHcn(false); }}>Save & mark Ready to Send</button>
              <button className="btn-outline" onClick={() => setShowHcn(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Dt({ l, v, cap }: { l: string; v: string | null; cap?: boolean }) {
  return (<><dt className="text-slate-400">{l}</dt><dd className={`font-medium ${cap ? "capitalize" : ""}`}>{v || "—"}</dd></>);
}
