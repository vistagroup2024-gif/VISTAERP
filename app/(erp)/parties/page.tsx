import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  customer: "Customer",
  supplier: "Supplier",
  b2b_agent: "B2B Agent",
};

export default async function PartiesPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("parties")
    .select("id, name, code, party_type, phone, currency, credit_limit, is_active")
    .order("party_type");

  return (
    <div>
      <PageHeader title="Customers / Agents / Suppliers" action={{ href: "/parties/new", label: "+ New Party" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Name</th>
              <th className="th">Code</th>
              <th className="th">Type</th>
              <th className="th">Phone</th>
              <th className="th">Currency</th>
              <th className="th text-right">Credit limit</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="td font-medium">{p.name}</td>
                <td className="td">{p.code ?? "—"}</td>
                <td className="td">
                  <span className="badge bg-cyan-100 text-cyan-800">{TYPE_LABEL[p.party_type]}</span>
                </td>
                <td className="td">{p.phone ?? "—"}</td>
                <td className="td">{p.currency ?? "—"}</td>
                <td className="td text-right">{p.credit_limit ? money(p.credit_limit, p.currency ?? "PKR") : "—"}</td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No parties yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
