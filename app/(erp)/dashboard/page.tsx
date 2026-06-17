import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

async function count(table: string) {
  const supabase = createClient();
  const { count } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function Dashboard() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user!.id);

  const hasRole = (roles?.length ?? 0) > 0;

  const [bookings, packages, hotels, invoices] = await Promise.all([
    count("bookings"),
    count("packages"),
    count("hotels"),
    count("invoices"),
  ]);

  const { data: invRows } = await supabase
    .from("invoices")
    .select("total, amount_paid, currency");
  const outstanding = (invRows ?? []).reduce(
    (s, r) => s + (Number(r.total) - Number(r.amount_paid)),
    0
  );

  const { data: recent } = await supabase
    .from("bookings")
    .select("id, booking_no, status, total_sell, sell_currency, travel_date")
    .order("created_at", { ascending: false })
    .limit(5);

  const cards = [
    { label: "Bookings", value: bookings, href: "/bookings" },
    { label: "Packages", value: packages, href: "/packages" },
    { label: "Hotels", value: hotels, href: "/hotels" },
    { label: "Invoices", value: invoices, href: "/invoices" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>

      {!hasRole && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your account has no role assigned yet, so data is hidden by row-level
          security. An admin must add a role in <code>user_roles</code> (e.g.
          <code> admin</code>) and set your <code>company_id</code> in{" "}
          <code>profiles</code>. See the README for the bootstrap SQL.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="card hover:shadow-md">
            <p className="text-sm text-slate-500">{c.label}</p>
            <p className="mt-1 text-3xl font-bold text-brand-dark">{c.value}</p>
          </Link>
        ))}
      </div>

      <div className="card">
        <p className="text-sm text-slate-500">Outstanding receivables (mixed currency, indicative)</p>
        <p className="mt-1 text-2xl font-bold text-slate-800">{money(outstanding, "PKR")}</p>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Recent bookings</h2>
          <Link href="/bookings" className="text-sm text-brand hover:underline">
            View all
          </Link>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="th">Booking #</th>
              <th className="th">Status</th>
              <th className="th">Travel</th>
              <th className="th text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(recent ?? []).map((b) => (
              <tr key={b.id} className="border-b border-slate-50">
                <td className="td font-medium">
                  <Link href={`/bookings/${b.id}`} className="text-brand hover:underline">
                    {b.booking_no}
                  </Link>
                </td>
                <td className="td capitalize">{b.status}</td>
                <td className="td">{b.travel_date ?? "—"}</td>
                <td className="td text-right">{money(b.total_sell, b.sell_currency)}</td>
              </tr>
            ))}
            {(recent ?? []).length === 0 && (
              <tr>
                <td className="td text-slate-400" colSpan={4}>
                  No bookings yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
