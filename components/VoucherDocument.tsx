// Presentational branded transport voucher, shared by the internal staff voucher
// and the public shareable voucher. Pure/no data access — callers pass in the
// resolved provider, booking, trips and QR image.
//
// Design goals: clean, modern, international-standard layout optimised for A4 PDF
// printing and mobile viewing. Shows only booking-relevant information.
import React from "react";

export interface VoucherProvider {
  name: string; tagline?: string | null; contact?: string | null; mobile?: string | null;
  email?: string | null; address?: string | null; logo?: string | null; note?: string | null;
}
export interface VoucherTrip {
  seq?: number | null; route?: string | null; trip_date?: string | null; trip_time?: string | null;
  pickup_location?: string | null; drop_location?: string | null; vehicle?: string | null;
  hajj_terminal?: boolean | null; fare?: number | null;
}
export interface VoucherBooking {
  booking_no?: string | null; booking_date?: string | null;
  passenger_name?: string | null; mobile?: string | null; whatsapp?: string | null; pax?: number | null;
  nationality?: string | null; remarks?: string | null;
  arrival_flight?: string | null; arrival_date?: string | null; arrival_time?: string | null;
  departure_flight?: string | null; departure_date?: string | null; departure_time?: string | null;
  total_amount?: number | null; currency?: string | null;
}

const exact = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Format an ISO date ("2026-08-03") as "03-Aug-2026" without timezone drift.
function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  return `${m[3]}-${MONTHS[Number(m[2]) - 1] ?? m[2]}-${m[1]}`;
}
function fmtTime(t?: string | null): string {
  return t ? t.slice(0, 5) : "—";
}
function fmtMoney(n: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)}`;
}

export default function VoucherDocument({ provider, booking: b, trips, qr, showFares = true, notes }: {
  provider: VoucherProvider; booking: VoucherBooking; trips: VoucherTrip[]; qr: string;
  showFares?: boolean; notes?: string | null;
  /** @deprecated static instructions are no longer rendered — kept for call-site compat */
  instructions?: string[];
}) {
  const sameContact = !!b.mobile && !!b.whatsapp && b.mobile.replace(/\D/g, "") === b.whatsapp.replace(/\D/g, "");
  const showWhatsapp = !!b.whatsapp && !sameContact;

  const currency = b.currency || "SAR";
  const tripTotal = trips.reduce((s, t) => s + (Number(t.fare) || 0), 0);
  const total = b.total_amount != null ? Number(b.total_amount) : tripTotal;
  const hasFlights = !!b.arrival_flight || !!b.departure_flight;

  const passenger: [string, React.ReactNode][] = [
    ["Passenger Name", b.passenger_name || "—"],
    ["Mobile Number", b.mobile || "—"],
  ];
  if (showWhatsapp) passenger.push(["WhatsApp Number", b.whatsapp]);
  passenger.push(["No. of Passengers", b.pax ?? "—"]);

  const noteText = (notes ?? b.remarks ?? provider.note ?? "").trim();

  return (
    <div className="print-doc mx-auto overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-brand px-8 pb-5 pt-7">
        <div className="flex items-center gap-3">
          {provider.logo ? (
            <img src={provider.logo} alt={provider.name} className="h-14 w-auto object-contain" style={exact} />
          ) : null}
          <div className="text-2xl font-bold tracking-tight text-slate-900">{provider.name}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold uppercase tracking-[0.18em] text-brand" style={exact}>Transport Voucher</div>
          <div className="mt-2 space-y-0.5 text-sm text-slate-600">
            <div><span className="text-slate-400">Booking Date :</span> <span className="font-semibold text-slate-800">{fmtDate(b.booking_date)}</span></div>
            <div><span className="text-slate-400">Booking ID :</span> <span className="font-semibold text-slate-800">{b.booking_no ?? "—"}</span></div>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* ── Passenger Details ─────────────────────────────────── */}
        <SectionTitle>Passenger Details</SectionTitle>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          {passenger.map(([label, val], i) => (
            <Field key={i} label={label} value={val} />
          ))}
        </div>

        {/* ── Flight Information (only when airport trips exist) ─── */}
        {hasFlights && (
          <>
            <SectionTitle className="mt-7">Flight Information</SectionTitle>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
              {b.arrival_flight && <Field label="Arrival Flight" value={b.arrival_flight} />}
              {b.departure_flight && <Field label="Departure Flight" value={b.departure_flight} />}
            </div>
          </>
        )}

        {/* ── Trip Details ──────────────────────────────────────── */}
        <SectionTitle className="mt-7">Trip Details</SectionTitle>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Time</th>
                <th className="px-3 py-2.5">Route</th>
                <th className="px-3 py-2.5">Vehicle</th>
                <th className="px-3 py-2.5">Pickup</th>
                <th className="px-3 py-2.5">Drop</th>
                {showFares && <th className="px-3 py-2.5 text-right">Fare</th>}
              </tr>
            </thead>
            <tbody>
              {trips.map((t, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2.5 text-slate-500">{i + 1}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(t.trip_date)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{fmtTime(t.trip_time)}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">
                    {t.route ?? "—"}
                    {t.hajj_terminal && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" style={exact}>Hajj Terminal</span>}
                  </td>
                  <td className="px-3 py-2.5">{t.vehicle ?? "—"}</td>
                  <td className="px-3 py-2.5">{t.pickup_location ?? "—"}</td>
                  <td className="px-3 py-2.5">{t.drop_location ?? "—"}</td>
                  {showFares && <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums">{t.fare != null ? fmtMoney(Number(t.fare), currency) : "—"}</td>}
                </tr>
              ))}
              {trips.length === 0 && (
                <tr><td colSpan={showFares ? 8 : 7} className="px-3 py-4 text-center text-slate-400">No trips.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Total Invoice Amount ──────────────────────────────── */}
        {showFares && (
          <div className="mt-4 flex justify-end">
            <div className="flex items-center gap-4 rounded-xl border border-brand/30 bg-brand/5 px-5 py-3" style={exact}>
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Invoice Amount</span>
              <span className="text-xl font-bold text-brand" style={exact}>{fmtMoney(total, currency)}</span>
            </div>
          </div>
        )}

        {/* ── Notes (booking-specific only; hidden when empty) ──── */}
        {noteText && (
          <div className="mt-6">
            <SectionTitle>Notes</SectionTitle>
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-600 whitespace-pre-line">{noteText}</div>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-200 pt-4">
          <div className="text-xs leading-relaxed text-slate-500">
            {provider.mobile && <div><span className="font-semibold text-slate-600">24/7 Assistance:</span> {provider.mobile}</div>}
            <div className="mt-0.5">Thank you for travelling with {provider.name}. Electronically generated — valid without a signature.</div>
          </div>
          {qr && <img src={qr} alt="Scan to view voucher" className="h-20 w-20 shrink-0 rounded-lg border border-slate-200 p-1" style={exact} />}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-3 flex items-center gap-2 ${className}`}>
      <span className="h-4 w-1 rounded-full bg-brand" style={exact} />
      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">{children}</h3>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  );
}
