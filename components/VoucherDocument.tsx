// Presentational branded voucher document, shared by the internal staff voucher
// and the public shareable voucher. Pure/no data access — callers pass in the
// resolved provider, booking, trips and QR image.
import React from "react";

export interface VoucherProvider {
  name: string; tagline?: string | null; contact?: string | null; mobile?: string | null;
  email?: string | null; address?: string | null; logo?: string | null; note?: string | null;
}
export interface VoucherTrip {
  seq?: number | null; route?: string | null; trip_date?: string | null; trip_time?: string | null;
  pickup_location?: string | null; drop_location?: string | null; vehicle?: string | null; hajj_terminal?: boolean | null;
}
export interface VoucherBooking {
  booking_no?: string | null; passenger_name?: string | null; mobile?: string | null; pax?: number | null;
  nationality?: string | null; remarks?: string | null;
  arrival_flight?: string | null; arrival_date?: string | null; arrival_time?: string | null;
  departure_flight?: string | null; departure_date?: string | null; departure_time?: string | null;
}

const exact = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any;

export default function VoucherDocument({ provider, booking: b, trips, qr, instructions }: {
  provider: VoucherProvider; booking: VoucherBooking; trips: VoucherTrip[]; qr: string; instructions: string[];
}) {
  return (
    <div className="print-doc overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Branded header band */}
      <div className="relative flex items-start justify-between gap-4 bg-brand px-8 py-6 text-white" style={exact}>
        <div className="flex items-center gap-4">
          {provider.logo ? <img src={provider.logo} alt={provider.name} className="h-16 w-auto rounded-lg bg-white/95 object-contain p-1.5" /> : null}
          <div>
            <div className="text-2xl font-extrabold leading-tight tracking-tight">{provider.name}</div>
            {provider.tagline && <div className="text-sm text-white/80">{provider.tagline}</div>}
            <div className="mt-1 text-xs text-white/80">{[provider.mobile, provider.email].filter(Boolean).join("  ·  ")}</div>
            {provider.address && <div className="text-xs text-white/70">{provider.address}</div>}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest">Transport Voucher</div>
          <div className="mt-1 text-xl font-bold">{b.booking_no ?? "—"}</div>
          <img src={qr} alt="QR" className="mt-2 h-24 w-24 rounded-lg bg-white p-1" style={exact} />
        </div>
      </div>

      <div className="p-8">
        {/* Passenger */}
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand">Passenger Details</div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-sm sm:grid-cols-3">
          {[
            ["Passenger", b.passenger_name || "—"],
            ["Mobile", b.mobile || "—"],
            ["Passengers", b.pax ?? "—"],
            ["Nationality", b.nationality || "—"],
            ["Arrival", [b.arrival_flight, b.arrival_date, b.arrival_time?.slice(0, 5)].filter(Boolean).join(" · ") || "—"],
            ["Departure", [b.departure_flight, b.departure_date, b.departure_time?.slice(0, 5)].filter(Boolean).join(" · ") || "—"],
          ].map(([label, val], i) => (
            <div key={i} className="bg-white px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
              <div className="font-semibold text-slate-800">{val as any}</div>
            </div>
          ))}
        </div>

        {/* Trips */}
        <div className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-brand">Itinerary</div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">#</th><th className="px-3 py-2">Route</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Time</th><th className="px-3 py-2">Pickup</th><th className="px-3 py-2">Drop</th><th className="px-3 py-2">Vehicle</th>
            </tr></thead>
            <tbody>
              {trips.map((t, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500">{t.seq ?? i + 1}</td>
                  <td className="px-3 py-2 font-semibold text-slate-800">{t.route ?? "—"}{t.hajj_terminal && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Hajj Terminal</span>}</td>
                  <td className="px-3 py-2">{t.trip_date ?? "—"}</td>
                  <td className="px-3 py-2">{t.trip_time?.slice(0, 5) ?? "—"}</td>
                  <td className="px-3 py-2">{t.pickup_location ?? "—"}</td>
                  <td className="px-3 py-2">{t.drop_location ?? "—"}</td>
                  <td className="px-3 py-2">{t.vehicle ?? "—"}</td>
                </tr>
              ))}
              {trips.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-slate-400">No trips.</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border-l-4 border-brand bg-brand/5 p-4 text-sm" style={exact}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">24/7 Assistance</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{provider.mobile}</div>
            <div className="text-xs text-slate-500">{provider.contact}</div>
          </div>
          <div className="sm:col-span-2 text-xs leading-relaxed text-slate-600">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Important Instructions</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {instructions.map((x, i) => <li key={i}>{x}</li>)}
              {provider.note && <li>{provider.note}</li>}
            </ul>
          </div>
        </div>
        {b.remarks && <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><b>Remarks:</b> {b.remarks}</div>}

        <div className="mt-6 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
          Thank you for travelling with {provider.name}. This voucher was generated electronically and is valid without a signature.
        </div>
      </div>
    </div>
  );
}
