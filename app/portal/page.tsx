import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Active packages an agent may browse (RLS allows b2b_agent to read active)
  const { data: packages } = await supabase
    .from("packages")
    .select("id, name, code, duration_days, description")
    .eq("status", "active");

  // Agent's own bookings & invoices (RLS scoped via auth_party_id)
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, booking_no, status, travel_date, total_sell, sell_currency")
    .order("created_at", { ascending: false });

  const { data: invoices } = await supabase
    .from("invoices")
    .select("id, invoice_no, total, amount_paid, currency, status");

  async function signOut() {
    "use server";
    const sb = createClient();
    await sb.auth.signOut();
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-dark">Vista Group — Partner Portal</h1>
        <form action={signOut}>
          <button className="btn-outline">Sign out</button>
        </form>
      </div>

      <section>
        <h2 className="mb-3 font-semibold">Available packages</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(packages ?? []).map((p) => (
            <div key={p.id} className="card">
              <p className="font-semibold">{p.name}</p>
              <p className="text-sm text-slate-500">{p.description}</p>
              <p className="mt-2 text-xs text-slate-400">{p.duration_days} days · {p.code}</p>
            </div>
          ))}
          {(packages ?? []).length === 0 && <p className="text-slate-400">No packages available.</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">My bookings</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Booking</th><th className="th">Status</th><th className="th">Travel</th><th className="th text-right">Total</th></tr></thead>
            <tbody>
              {(bookings ?? []).map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="td">{b.booking_no}</td>
                  <td className="td capitalize">{b.status}</td>
                  <td className="td">{dateStr(b.travel_date)}</td>
                  <td className="td text-right">{money(b.total_sell, b.sell_currency)}</td>
                </tr>
              ))}
              {(bookings ?? []).length === 0 && <tr><td className="td text-slate-400" colSpan={4}>No bookings yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">My invoices &amp; ledger</h2>
        <div className="card overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="th">Invoice</th><th className="th">Status</th><th className="th text-right">Total</th><th className="th text-right">Balance</th></tr></thead>
            <tbody>
              {(invoices ?? []).map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="td">{i.invoice_no}</td>
                  <td className="td capitalize">{i.status.replace("_", " ")}</td>
                  <td className="td text-right">{money(i.total, i.currency)}</td>
                  <td className="td text-right">{money(Number(i.total) - Number(i.amount_paid), i.currency)}</td>
                </tr>
              ))}
              {(invoices ?? []).length === 0 && <tr><td className="td text-slate-400" colSpan={4}>No invoices yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          <Link href="/portal/book" className="text-brand hover:underline">Create a booking request →</Link>
        </p>
      </section>
    </main>
  );
}
