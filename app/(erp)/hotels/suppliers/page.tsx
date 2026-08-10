import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

// Hotel Suppliers = parties (party_type 'supplier'). Shows hotel booking count and
// outstanding payable (from the shared bills ledger) per supplier.
export default async function HotelSuppliersPage() {
  await guardStaffPage("hotels.suppliers");
  const supabase = createClient();
  const [{ data: suppliers }, { data: purch }] = await Promise.all([
    supabase.from("parties").select("id, name, phone, email, currency, is_active").eq("party_type", "supplier").order("name"),
    supabase.from("hotel_purchase_bookings").select("supplier_id, purchase_total, bill_id, bills:bill_id(total, amount_paid)"),
  ]);

  const stat = new Map<string, { count: number; outstanding: number }>();
  (purch ?? []).forEach((p: any) => {
    if (!p.supplier_id) return;
    const s = stat.get(p.supplier_id) ?? { count: 0, outstanding: 0 };
    s.count += 1;
    if (p.bills) s.outstanding += (Number(p.bills.total) || 0) - (Number(p.bills.amount_paid) || 0);
    stat.set(p.supplier_id, s);
  });

  return (
    <div>
      <PageHeader title="Hotel Suppliers / Vendors" action={{ href: "/parties", label: "Manage Parties" }} />
      <p className="mb-3 text-sm text-slate-500">Suppliers come from the shared party master; hotel purchases post to the shared payables ledger.</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50"><tr>
            <th className="th">Supplier</th><th className="th">Contact</th><th className="th">Currency</th>
            <th className="th">Hotel Bookings</th><th className="th">Outstanding Payable</th><th className="th">Status</th>
          </tr></thead>
          <tbody>
            {(suppliers ?? []).map((s: any) => {
              const st = stat.get(s.id) ?? { count: 0, outstanding: 0 };
              return (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="td font-medium">{s.name}</td>
                  <td className="td">{s.phone ?? s.email ?? "—"}</td>
                  <td className="td">{s.currency ?? "—"}</td>
                  <td className="td">{st.count}</td>
                  <td className="td font-semibold text-orange-700">{st.outstanding > 0 ? money(st.outstanding, s.currency ?? "SAR") : "—"}</td>
                  <td className="td"><span className={`badge ${s.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{s.is_active ? "Active" : "Inactive"}</span></td>
                </tr>
              );
            })}
            {(suppliers ?? []).length === 0 && <tr><td className="td text-slate-400" colSpan={6}>No suppliers. Add one under Customers / Agents (Parties) with type Supplier.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
