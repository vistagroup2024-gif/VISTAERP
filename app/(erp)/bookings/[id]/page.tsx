import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { dateStr, money } from "@/lib/format";
import BookingActions from "./BookingActions";

export const dynamic = "force-dynamic";

export default async function BookingDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select("*, parties:customer_id(name), packages:package_id(name)")
    .eq("id", params.id)
    .single();
  if (!b) notFound();

  const [{ data: pax }, { data: items }, { data: invoice }] = await Promise.all([
    supabase.from("booking_pax").select("*").eq("booking_id", params.id),
    supabase.from("booking_items").select("*").eq("booking_id", params.id),
    supabase.from("invoices").select("id, invoice_no").eq("booking_id", params.id).maybeSingle(),
  ]);

  const c: any = b;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{c.booking_no}</h1>
          <p className="text-slate-500">
            {c.parties?.name} · {c.packages?.name ?? "Ad-hoc"} · {dateStr(c.travel_date)}
          </p>
          <span className="badge mt-2 bg-cyan-100 capitalize text-cyan-800">{c.status}</span>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-500">Total</p>
          <p className="text-2xl font-bold text-brand-dark">{money(c.total_sell, c.sell_currency)}</p>
        </div>
      </div>

      <BookingActions
        bookingId={c.id}
        status={c.status}
        invoiceId={invoice?.id ?? null}
        invoiceNo={invoice?.invoice_no ?? null}
      />

      <div className="card">
        <h2 className="mb-3 font-semibold">Passengers</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100"><th className="th">Name</th><th className="th">Passport</th><th className="th">Nationality</th></tr></thead>
          <tbody>
            {(pax ?? []).map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="td">{p.full_name}</td>
                <td className="td">{p.passport_no ?? "—"}</td>
                <td className="td">{p.nationality ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">Services</h2>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-100"><th className="th">Service</th><th className="th">Description</th><th className="th text-right">Qty</th><th className="th text-right">Sell</th></tr></thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id} className="border-b border-slate-50">
                <td className="td capitalize">{i.service_type.replace("_", " ")}</td>
                <td className="td">{i.description}</td>
                <td className="td text-right">{i.qty}</td>
                <td className="td text-right">{money(Number(i.sell_price) * Number(i.qty), i.sell_currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {invoice && (
        <Link href={`/invoices/${invoice.id}`} className="text-brand hover:underline">
          View invoice {invoice.invoice_no} →
        </Link>
      )}
    </div>
  );
}
