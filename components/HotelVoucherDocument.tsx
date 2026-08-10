import { dateStr } from "@/lib/format";

export interface HotelVoucherProvider {
  name: string; tagline?: string; contact?: string; mobile?: string; email?: string; address?: string; logo?: string; note?: string | null;
}
export interface HotelVoucherData {
  booking_no: string; guest_name: string; group_no?: string | null; agent?: string | null;
  hotel_name?: string | null; city?: string | null; check_in?: string | null; check_out?: string | null;
  nights?: number | null; room_type?: string | null; rooms?: number | null; guests?: number | null;
  meal_plan?: string | null; hcn?: string | null;
}

// Client-safe hotel voucher (HTML + Tailwind, printed to PDF via the browser —
// same pattern as the transport voucher). Never renders supplier/cost/profit.
export default function HotelVoucherDocument({ provider, booking, qr }: { provider: HotelVoucherProvider; booking: HotelVoucherData; qr?: string }) {
  const Row = ({ l, v }: { l: string; v: any }) => (
    <div className="flex justify-between border-b border-slate-100 py-1.5 text-sm"><span className="text-slate-500">{l}</span><span className="font-medium text-slate-800">{v || "—"}</span></div>
  );
  return (
    <div className="print-doc mx-auto max-w-2xl bg-white p-8 text-slate-800" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any}>
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          {provider.logo && <img src={provider.logo} alt="" className="h-12 w-12" />}
          <div>
            <div className="text-xl font-bold">{provider.name}</div>
            {provider.tagline && <div className="text-xs text-slate-500">{provider.tagline}</div>}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          {provider.mobile && <div>{provider.mobile}</div>}
          {provider.email && <div>{provider.email}</div>}
          {provider.address && <div>{provider.address}</div>}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Hotel Voucher</h1>
        <span className="rounded bg-slate-800 px-2 py-1 text-xs font-semibold text-white">{booking.booking_no}</span>
      </div>

      <div className="mt-4 grid gap-x-8 md:grid-cols-2">
        <div>
          <Row l="Guest / Group" v={booking.guest_name} />
          <Row l="Group No." v={booking.group_no} />
          <Row l="Agent" v={booking.agent} />
          <Row l="Hotel" v={booking.hotel_name} />
          <Row l="City" v={booking.city ? String(booking.city).replace(/^\w/, (c) => c.toUpperCase()) : "—"} />
        </div>
        <div>
          <Row l="Check-in" v={dateStr(booking.check_in)} />
          <Row l="Check-out" v={dateStr(booking.check_out)} />
          <Row l="Nights" v={booking.nights} />
          <Row l="Room Type" v={booking.room_type} />
          <Row l="Rooms / Guests" v={`${booking.rooms ?? "—"} / ${booking.guests ?? "—"}`} />
          <Row l="Meal Plan" v={booking.meal_plan} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border-2 border-dashed border-slate-300 p-3 text-center">
        <div className="text-xs uppercase tracking-wide text-slate-400">Hotel Confirmation Number (HCN)</div>
        <div className="text-2xl font-bold tracking-widest">{booking.hcn || "Pending"}</div>
      </div>

      <div className="mt-6 flex items-end justify-between">
        <div className="text-xs text-slate-500">{provider.note || "Please present this voucher at hotel reception on arrival."}</div>
        {qr && <img src={qr} alt="QR" className="h-24 w-24" />}
      </div>
    </div>
  );
}
