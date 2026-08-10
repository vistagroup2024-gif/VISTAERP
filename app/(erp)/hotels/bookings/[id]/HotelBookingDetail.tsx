"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr, money } from "@/lib/format";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import {
  HOTEL_STATUS_LABEL, HOTEL_STATUS_TONE, VENDOR_STATUS_LABEL, VENDOR_STATUS_ORDER, HCN_STATUS_LABEL,
} from "../../lib";

interface Perms {
  canEdit: boolean; canPurchase: boolean; canPurchaseRate: boolean; canProfit: boolean;
  canHcn: boolean; canCancel: boolean; canPayable: boolean; canVoucher: boolean; canSupplier: boolean;
}
interface Opt { id: string; name: string }

export default function HotelBookingDetail({
  booking, purchase, suppliers, hotels, perms, timeline,
}: {
  booking: any; purchase: any | null; suppliers: Opt[]; hotels: Opt[]; perms: Perms; timeline: any[];
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
  const purch = purchase;
  const saleTotal = Number(booking.sale_total) || 0;
  const purchTotal = Number(purch?.purchase_total) || 0;
  const profit = saleTotal - purchTotal;
  const margin = saleTotal > 0 ? (profit / saleTotal) * 100 : 0;

  // ---- Purchase form state ----
  const [pf, setPf] = useState({
    supplier_id: purch?.supplier_id ?? "",
    hotel_id: purch?.hotel_id ?? booking.hotel_id ?? "",
    hotel_name: purch?.hotel_name ?? booking.hotel_name ?? "",
    room_type: purch?.room_type ?? booking.room_type ?? "",
    check_in: purch?.check_in ?? booking.check_in ?? "",
    check_out: purch?.check_out ?? booking.check_out ?? "",
    rooms: purch?.rooms ?? booking.rooms ?? 1,
    purchase_rate: purch?.purchase_rate ?? "",
    purchase_total: purch?.purchase_total ?? "",
    currency: purch?.currency ?? "SAR",
    supplier_ref: purch?.supplier_ref ?? "",
    notes: purch?.notes ?? "",
  });
  const setP = (k: string, v: any) => setPf((s) => ({ ...s, [k]: v }));

  async function savePurchase() {
    await rpc("hotel_purchase_save", { p_id: purch?.id ?? null, p_booking: booking.id, p: pf });
  }

  // ---- HCN form ----
  const [hcn, setHcn] = useState({
    hcn: purch?.hcn ?? "", received: purch?.hcn_received_date ?? "", confirmation: purch?.confirmation_date ?? "", ref: purch?.vendor_confirmation_ref ?? "",
  });

  // ---- Cancel ----
  const [showCancel, setShowCancel] = useState<null | "sales" | "supplier">(null);
  const [cf, setCf] = useState({ reason: "", supplier_cancel_status: "", supplier_charges: "", client_refund: "", notes: "" });

  return (
    <div className="space-y-6">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* Header + lifecycle actions */}
      <div className="card flex flex-wrap items-center gap-3">
        <span className={`badge ${HOTEL_STATUS_TONE[st] ?? "bg-slate-100"}`}>{HOTEL_STATUS_LABEL[st] ?? st}</span>
        {purch && <span className="badge bg-slate-100 text-slate-600">{VENDOR_STATUS_LABEL[purch.vendor_status] ?? purch.vendor_status}</span>}
        {purch && <span className="badge bg-slate-100 text-slate-600">{HCN_STATUS_LABEL[purch.hcn_status] ?? purch.hcn_status}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {perms.canEdit && st !== "cancelled" && <Link href={`/hotels/bookings/${booking.id}/edit`} className="btn-outline text-sm">Edit</Link>}
          {perms.canVoucher && <Link href={`/hotels/bookings/${booking.id}/voucher`} className="btn-outline text-sm">Voucher</Link>}
          {!booking.checked_in_at && st !== "cancelled" && perms.canEdit &&
            <button disabled={busy} className="btn-outline text-sm" onClick={() => rpc("hotel_booking_checkin", { p_id: booking.id })}>Mark Check-in</button>}
          {booking.checked_in_at && !booking.checked_out_at && perms.canEdit &&
            <button disabled={busy} className="btn-outline text-sm" onClick={() => rpc("hotel_booking_checkout", { p_id: booking.id })}>Mark Check-out</button>}
          {perms.canCancel && st !== "cancelled" &&
            <button className="btn-outline text-sm text-red-600" onClick={() => setShowCancel("sales")}>Cancel</button>}
        </div>
      </div>

      {/* Guest + stay summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Guest / Group</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Dt l="Guest / Group" v={booking.guest_name} />
            <Dt l="Group No." v={booking.group_no} />
            <Dt l="Agent" v={booking.agent_name} />
            <Dt l="Agent Ref" v={booking.agent_ref} />
            <Dt l="Mobile" v={booking.mobile} />
            <Dt l="WhatsApp" v={booking.whatsapp} />
            <Dt l="Nationality" v={booking.nationality} />
            <Dt l="Rooms / Guests" v={`${booking.rooms} / ${booking.guests}`} />
            <Dt l="Managed By" v={booking.managed_by} />
            <Dt l="Source" v={booking.source} />
          </dl>
          {booking.special_requests && <p className="mt-2 text-sm text-slate-500">📝 {booking.special_requests}</p>}
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold text-slate-700">Hotel Stay</h2>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Dt l="City" v={booking.city} cap />
            <Dt l="Hotel" v={booking.hotel_display} />
            <Dt l="Check-in" v={dateStr(booking.check_in)} />
            <Dt l="Check-out" v={dateStr(booking.check_out)} />
            <Dt l="Nights" v={String(booking.nights)} />
            <Dt l="Room Type" v={booking.room_type} />
            <Dt l="Meal Plan" v={booking.meal_plan} />
          </dl>
          {booking.hotel_requirements && <p className="mt-2 text-sm text-slate-500">🏨 {booking.hotel_requirements}</p>}
          <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Sales Total</span><b>{money(saleTotal, "SAR")}</b></div>
            {perms.canProfit && (
              <>
                <div className="flex justify-between"><span className="text-slate-400">Purchase Total</span><b>{money(purchTotal, "SAR")}</b></div>
                <div className="flex justify-between"><span className="text-slate-400">Gross Profit</span><b className={profit >= 0 ? "text-green-700" : "text-red-600"}>{money(profit, "SAR")} ({margin.toFixed(1)}%)</b></div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* Purchase / Vendor booking */}
      {perms.canPurchase && (
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-700">Purchase / Vendor Booking</h2>
            {purch && (
              <select className="input max-w-xs" disabled={busy} value={purch.vendor_status}
                onChange={(e) => rpc("hotel_purchase_set_vendor_status", { p_id: purch.id, p_status: e.target.value, p_note: null })}>
                {VENDOR_STATUS_ORDER.map((s) => <option key={s} value={s}>{VENDOR_STATUS_LABEL[s]}</option>)}
              </select>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {perms.canSupplier && (
              <div><label className="label">Supplier / Vendor</label>
                <select className="input" value={pf.supplier_id} onChange={(e) => setP("supplier_id", e.target.value)}>
                  <option value="">— Select —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div><label className="label">Hotel</label>
              <select className="input" value={pf.hotel_id} onChange={(e) => setP("hotel_id", e.target.value)}>
                <option value="">— Free text —</option>
                {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div><label className="label">Hotel (free text)</label><input className="input" value={pf.hotel_name} disabled={!!pf.hotel_id} onChange={(e) => setP("hotel_name", e.target.value)} /></div>
            <div><label className="label">Room Type</label><input className="input" value={pf.room_type} onChange={(e) => setP("room_type", e.target.value)} /></div>
            <div><label className="label">Check-in</label><input type="date" className="input" value={pf.check_in} onChange={(e) => setP("check_in", e.target.value)} /></div>
            <div><label className="label">Check-out</label><input type="date" className="input" value={pf.check_out} onChange={(e) => setP("check_out", e.target.value)} /></div>
            <div><label className="label">Rooms</label><input type="number" min={1} className="input" value={pf.rooms} onChange={(e) => setP("rooms", e.target.value)} /></div>
            {perms.canPurchaseRate && <div><label className="label">Purchase Rate</label><input type="number" step="0.01" className="input" value={pf.purchase_rate} onChange={(e) => setP("purchase_rate", e.target.value)} /></div>}
            {perms.canPurchaseRate && <div><label className="label">Purchase Total</label><input type="number" step="0.01" className="input" value={pf.purchase_total} onChange={(e) => setP("purchase_total", e.target.value)} /></div>}
            <div><label className="label">Currency</label><input className="input" value={pf.currency} onChange={(e) => setP("currency", e.target.value)} /></div>
            <div><label className="label">Supplier Reference</label><input className="input" value={pf.supplier_ref} onChange={(e) => setP("supplier_ref", e.target.value)} /></div>
            <div className="md:col-span-3"><label className="label">Booking Notes</label><textarea className="input" rows={2} value={pf.notes} onChange={(e) => setP("notes", e.target.value)} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className="btn" onClick={savePurchase}>{purch ? "Save purchase" : "Create purchase booking"}</button>
            {perms.canPayable && purch && !purch.bill_id &&
              <button disabled={busy} className="btn-outline" onClick={() => rpc("hotel_purchase_post_payable", { p_id: purch.id })}>Post Supplier Payable</button>}
            {purch?.bill_id && <Link href={`/purchase/bills/${purch.bill_id}`} className="btn-outline">View Payable →</Link>}
          </div>
        </section>
      )}

      {/* HCN */}
      {perms.canHcn && purch && (
        <section className="card space-y-4">
          <h2 className="font-semibold text-slate-700">HCN — Hotel Confirmation Number</h2>
          <div className="grid gap-4 md:grid-cols-4">
            <div><label className="label">HCN</label><input className="input" value={hcn.hcn} onChange={(e) => setHcn({ ...hcn, hcn: e.target.value })} /></div>
            <div><label className="label">HCN Received Date</label><input type="date" className="input" value={hcn.received} onChange={(e) => setHcn({ ...hcn, received: e.target.value })} /></div>
            <div><label className="label">Confirmation Date</label><input type="date" className="input" value={hcn.confirmation} onChange={(e) => setHcn({ ...hcn, confirmation: e.target.value })} /></div>
            <div><label className="label">Vendor Confirmation Ref</label><input className="input" value={hcn.ref} onChange={(e) => setHcn({ ...hcn, ref: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} className="btn" onClick={() => rpc("hotel_hcn_save", { p_id: purch.id, p_hcn: hcn.hcn || null, p_received: hcn.received || null, p_confirmation: hcn.confirmation || null, p_ref: hcn.ref || null })}>Save HCN</button>
            <button disabled={busy || !purch.hcn} className="btn-outline" onClick={() => rpc("hotel_hcn_share", { p_id: purch.id })}>Share HCN with Client</button>
            {purch.hcn_shared && <span className="text-sm text-green-700">✓ Shared {purch.hcn_shared_at ? dateStr(purch.hcn_shared_at) : ""} by {purch.hcn_shared_by ?? ""}</span>}
          </div>
          <p className="text-xs text-slate-400">Sharing exposes only the client-safe confirmation (no supplier, cost, or internal notes).</p>
        </section>
      )}

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

function Dt({ l, v, cap }: { l: string; v: string | null; cap?: boolean }) {
  return (<><dt className="text-slate-400">{l}</dt><dd className={`font-medium ${cap ? "capitalize" : ""}`}>{v || "—"}</dd></>);
}
