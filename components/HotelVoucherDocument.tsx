// Presentational branded hotel voucher/invoice, shared by the internal staff
// print page and the public shareable voucher. Pure/no data access — callers
// pass in the resolved provider, booking, stays and QR image.
//
// Two documents from one component:
//  - "voucher" (default): no pricing anywhere — safe to hand to the guest/hotel.
//  - "invoice": adds Rate/Total columns, a grand total and bank details —
//    for billing the client. Never mixed with supplier/cost/profit figures.
import React from "react";
import { dateStr } from "@/lib/format";

export interface HotelVoucherProvider {
  name: string; tagline?: string | null; contact?: string | null; mobile?: string | null;
  email?: string | null; address?: string | null; logo?: string | null; note?: string | null;
  logoLockup?: boolean;
}
export interface HotelVoucherStay {
  hotel_name?: string | null; city?: string | null; check_in?: string | null; check_out?: string | null;
  nights?: number | null; room_type?: string | null; room_summary?: string | null; rooms?: number | null;
  meal_plan?: string | null; hcn?: string | null;
  sale_rate?: number | null; sale_total?: number | null; currency?: string | null;
}
export interface HotelVoucherData {
  booking_no: string; booking_date?: string | null; guest_name: string; group_no?: string | null; agent?: string | null;
  guests?: number | null;
  // Legacy single-stay fields, used as a fallback when `stays` isn't supplied.
  hotel_name?: string | null; city?: string | null; check_in?: string | null; check_out?: string | null;
  nights?: number | null; room_type?: string | null; room_summary?: string | null; rooms?: number | null;
  meal_plan?: string | null; hcn?: string | null;
  stays?: HotelVoucherStay[];
}
export interface HotelVoucherBank {
  bankName: string; accountName: string; accountNumber: string; iban: string; swift?: string | null;
}

const exact = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as any;

function fmtMoney(n: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}
function cityLabel(c?: string | null): string {
  return c ? String(c).replace(/^\w/, (ch) => ch.toUpperCase()) : "—";
}

export default function HotelVoucherDocument({ provider, booking: b, qr, docType = "voucher", bank, terms }: {
  provider: HotelVoucherProvider; booking: HotelVoucherData; qr?: string;
  docType?: "voucher" | "invoice"; bank?: HotelVoucherBank; terms?: string[] | null;
}) {
  const isInvoice = docType === "invoice";
  const stays: HotelVoucherStay[] = b.stays && b.stays.length > 0
    ? b.stays
    : [{
        hotel_name: b.hotel_name, city: b.city, check_in: b.check_in, check_out: b.check_out,
        nights: b.nights, room_type: b.room_type, room_summary: b.room_summary, rooms: b.rooms,
        meal_plan: b.meal_plan, hcn: b.hcn,
      }];
  const currency = stays.find((s) => s.currency)?.currency || "SAR";
  const rowTotal = (s: HotelVoucherStay) =>
    s.sale_total != null ? Number(s.sale_total) : (Number(s.sale_rate) || 0) * (Number(s.nights) || 0) * (Number(s.rooms) || 0);
  const grandTotal = stays.reduce((sum, s) => sum + rowTotal(s), 0);
  // The voucher is handed to the guest, so an unconfirmed HCN is left off
  // rather than printed as "Pending" — the column appears only once at
  // least one stay actually has a number, and only on the voucher (never
  // the invoice, which is a billing document, not a hotel confirmation).
  const showHcnCol = !isInvoice && stays.some((s) => s.hcn);

  // "Agent" here just names the walk-in/customer type for direct bookings, not
  // a real booking agent — not worth a line on a document meant for the guest.
  const GENERIC_AGENT_NAMES = new Set(["umrah package customer", "cash customer", "hotel customer"]);
  const showAgent = !!b.agent && !GENERIC_AGENT_NAMES.has(b.agent.trim().toLowerCase());

  const guest: [string, React.ReactNode][] = [["Guest / Group", b.guest_name || "—"]];
  if (b.group_no) guest.push(["Group No.", b.group_no]);
  if (showAgent) guest.push(["Agent", b.agent]);
  guest.push(["Guests", b.guests ?? "—"]);

  return (
    <div className="print-doc mx-auto overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-sm">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-brand px-8 pb-5 pt-7">
        {provider.logoLockup ? (
          <div className="flex flex-col items-start gap-1">
            {provider.logo ? <img src={provider.logo} alt={provider.name} className="h-14 w-auto object-contain" style={exact} /> : null}
            <div className="text-2xl font-bold leading-none tracking-tight text-brand" style={exact}>{provider.name}</div>
            {provider.tagline && <div className="text-[11px] font-medium tracking-wide text-slate-500">{provider.tagline}</div>}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {provider.logo ? <img src={provider.logo} alt={provider.name} className="h-14 w-auto object-contain" style={exact} /> : null}
            <div className="text-2xl font-bold tracking-tight text-slate-900">{provider.name}</div>
          </div>
        )}
        <div className="text-right">
          <div className="text-lg font-bold uppercase tracking-[0.18em] text-brand" style={exact}>
            {isInvoice ? "Hotel Invoice" : "Hotel Voucher"}
          </div>
          <div className="mt-2 space-y-0.5 text-sm text-slate-600">
            {b.booking_date && <div><span className="text-slate-400">Booking Date :</span> <span className="font-semibold text-slate-800">{dateStr(b.booking_date)}</span></div>}
            <div><span className="text-slate-400">Booking ID :</span> <span className="font-semibold text-slate-800">{b.booking_no}</span></div>
          </div>
        </div>
      </div>

      <div className="px-8 py-6">
        {/* ── Guest Details ─────────────────────────────────────── */}
        <SectionTitle>Guest Details</SectionTitle>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          {guest.map(([label, val], i) => (
            <Field key={i} label={label} value={val} />
          ))}
        </div>

        {/* ── Stay Details ──────────────────────────────────────── */}
        <SectionTitle className="mt-7">Stay Details</SectionTitle>
        {/* table-fixed + a colgroup keeps every column's width within the page
            regardless of content length, so the last column (Total, on the
            invoice) never gets pushed past the printable A4 width — an
            overflow-x-auto table would just be scrolled off and lost when
            printed, since print has no scrollbar to reveal it. */}
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full table-fixed border-collapse text-xs">
            <colgroup>
              <col style={{ width: isInvoice ? "12%" : "16%" }} />
              <col style={{ width: isInvoice ? "10%" : "11%" }} />
              <col style={{ width: isInvoice ? "10%" : "11%" }} />
              <col style={{ width: isInvoice ? "10%" : "11%" }} />
              <col style={{ width: isInvoice ? "6%" : "6%" }} />
              <col style={{ width: isInvoice ? "10%" : (showHcnCol ? "12%" : "14%") }} />
              <col style={{ width: isInvoice ? "6%" : "6%" }} />
              <col style={{ width: isInvoice ? "12%" : (showHcnCol ? "15%" : "19%") }} />
              {isInvoice ? (<><col style={{ width: "11%" }} /><col style={{ width: "13%" }} /></>) : (showHcnCol && <col style={{ width: "13%" }} />)}
            </colgroup>
            <thead>
              <tr className="bg-brand text-left text-[10px] font-semibold uppercase tracking-wide text-white" style={exact}>
                <th className="px-2 py-2">Hotel Name</th>
                <th className="px-2 py-2">City</th>
                <th className="px-2 py-2">Check In</th>
                <th className="px-2 py-2">Check Out</th>
                <th className="px-2 py-2 text-right">Nts</th>
                <th className="px-2 py-2">Room Type</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2">Meal</th>
                {isInvoice ? (
                  <>
                    <th className="px-2 py-2 text-right">Rate</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </>
                ) : (
                  showHcnCol && <th className="px-2 py-2">Conf. No.</th>
                )}
              </tr>
            </thead>
            <tbody>
              {stays.map((s, i) => (
                <tr key={i} className={`border-t border-slate-100 align-top ${i % 2 ? "bg-brand/5" : "bg-white"}`} style={exact}>
                  <td className="break-words px-2 py-2 font-medium text-slate-800">{s.hotel_name || "—"}</td>
                  <td className="break-words px-2 py-2 capitalize">{cityLabel(s.city)}</td>
                  <td className="px-2 py-2">{dateStr(s.check_in)}</td>
                  <td className="px-2 py-2">{dateStr(s.check_out)}</td>
                  <td className="px-2 py-2 text-right">{s.nights ?? "—"}</td>
                  <td className="break-words px-2 py-2">{s.room_summary || s.room_type || "—"}</td>
                  <td className="px-2 py-2 text-right">{s.rooms ?? "—"}</td>
                  <td className="break-words px-2 py-2">{s.meal_plan || "—"}</td>
                  {isInvoice ? (
                    <>
                      <td className="break-words px-2 py-2 text-right tabular-nums">{s.sale_rate != null ? fmtMoney(Number(s.sale_rate), s.currency || currency) : "—"}</td>
                      <td className="break-words px-2 py-2 text-right tabular-nums font-medium">{fmtMoney(rowTotal(s), s.currency || currency)}</td>
                    </>
                  ) : (
                    showHcnCol && <td className="break-words px-2 py-2 font-mono">{s.hcn || "—"}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Terms & Conditions (left) + Total / Bank Details (right) ──
            A fixed grid, not an `lg:` breakpoint — this renders inside a
            printed A4 page, whose CSS width never reaches a `lg:` viewport
            breakpoint, so a responsive class would silently never apply. ── */}
        {isInvoice && (
          <div className="mt-4 grid grid-cols-[1fr_300px] items-start gap-5">
            {terms && terms.length > 0 ? (
              <div>
                <SectionTitle>Terms &amp; Conditions</SectionTitle>
                <ul className="space-y-1.5 text-[10.5px] leading-relaxed text-slate-600">
                  {terms.map((t, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="shrink-0 text-brand">•</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <div />}

            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-start gap-1 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3" style={exact}>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total ({currency})</span>
                <span className="text-xl font-bold text-brand" style={exact}>{fmtMoney(grandTotal, currency)}</span>
              </div>

              {bank && (
                <div>
                  <SectionTitle>Bank Details</SectionTitle>
                  <div className="flex flex-col gap-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <Field label="Bank Name" value={bank.bankName} />
                    <Field label="Account Name" value={bank.accountName} />
                    <Field label="Account Number" value={bank.accountNumber} mono />
                    <Field label="IBAN Number" value={bank.iban} mono />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────── */}
        <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-200 pt-4">
          <div className="text-xs leading-relaxed text-slate-500">
            {provider.mobile && <div><span className="font-semibold text-slate-600">24/7 Assistance:</span> {provider.mobile}</div>}
            <div className="mt-0.5">
              {provider.note || (isInvoice ? "Electronically generated — valid without a signature." : "Please present this voucher at hotel reception on arrival.")}
            </div>
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

function Field({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-semibold text-slate-800 ${mono ? "break-all font-mono tabular-nums" : ""}`}>{value}</div>
    </div>
  );
}
