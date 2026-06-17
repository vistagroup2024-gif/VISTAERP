"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

const STATUSES = ["held", "confirmed", "traveled", "closed", "cancelled"];

export default function BookingActions({
  bookingId,
  status,
  invoiceId,
  invoiceNo,
}: {
  bookingId: string;
  status: string;
  invoiceId: string | null;
  invoiceNo: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(s: string) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("bookings").update({ status: s }).eq("id", bookingId);
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  async function generateInvoice() {
    setBusy(true);
    setError(null);

    const { data: booking } = await supabase
      .from("bookings")
      .select("customer_id, sell_currency, fx_rate, total_sell")
      .eq("id", bookingId)
      .single();
    const { data: items } = await supabase
      .from("booking_items")
      .select("description, qty, sell_price")
      .eq("booking_id", bookingId);

    if (!booking) { setBusy(false); return setError("Booking not found"); }

    const subtotal = (items ?? []).reduce((s, i) => s + Number(i.sell_price) * Number(i.qty), 0);

    const { data: invNo, error: nErr } = await supabase.rpc("next_doc_number", {
      p_company: COMPANY_ID,
      p_doc_type: "invoice",
    });
    if (nErr) { setBusy(false); return setError(nErr.message); }

    const { data: inv, error: iErr } = await supabase
      .from("invoices")
      .insert({
        company_id: COMPANY_ID,
        invoice_no: invNo,
        booking_id: bookingId,
        customer_id: booking.customer_id,
        currency: booking.sell_currency,
        fx_rate: booking.fx_rate,
        subtotal,
        tax_rate: 0,
        tax_amount: 0,
        total: subtotal,
        status: "issued",
      })
      .select("id")
      .single();
    if (iErr || !inv) { setBusy(false); return setError(iErr?.message ?? "Failed"); }

    if (items?.length) {
      await supabase.from("invoice_lines").insert(
        items.map((i) => ({
          invoice_id: inv.id,
          description: i.description,
          qty: i.qty,
          unit_price: i.sell_price,
          line_total: Number(i.sell_price) * Number(i.qty),
        }))
      );
    }
    setBusy(false);
    router.push(`/invoices/${inv.id}`);
  }

  return (
    <div className="card space-y-3">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">Set status:</span>
        {STATUSES.map((s) => (
          <button
            key={s}
            disabled={busy || s === status}
            onClick={() => changeStatus(s)}
            className={`rounded-md border px-3 py-1 text-sm capitalize ${
              s === status ? "border-brand bg-brand text-white" : "border-slate-300 hover:bg-slate-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {!invoiceId && (
        <button className="btn" disabled={busy} onClick={generateInvoice}>
          {busy ? "Working…" : "Generate Invoice"}
        </button>
      )}
      {invoiceId && (
        <p className="text-sm text-green-700">Invoice {invoiceNo} generated.</p>
      )}
    </div>
  );
}
