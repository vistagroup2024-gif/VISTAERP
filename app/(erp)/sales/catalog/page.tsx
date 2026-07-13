import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import DeleteButton from "@/components/DeleteButton";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  visa: "Visa", transport: "Transport", hotel: "Hotel",
  air_ticket: "Air Ticket", insurance: "Insurance", ziyarat: "Ziyarat", other: "Other",
};

export default async function CatalogPage() {
  const supabase = createClient();
  const { data: rows } = await supabase
    .from("service_catalog")
    .select("id, code, name, service_type, default_cost, cost_currency, list_price, sell_currency, is_active")
    .order("service_type");

  return (
    <div>
      <PageHeader title="Service Catalog" action={{ href: "/sales/catalog/new", label: "+ New Service" }} />
      <p className="mb-4 text-sm text-slate-500">Master list of sellable services. List price is the default; per-customer rates override it on orders.</p>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th>
              <th className="th">Service</th>
              <th className="th">Type</th>
              <th className="th text-right">Cost</th>
              <th className="th text-right">List price</th>
              <th className="th">Status</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="td font-mono">{s.code ?? "—"}</td>
                <td className="td font-medium">
                  <Link href={`/sales/catalog/${s.id}`} className="text-brand hover:underline">{s.name}</Link>
                </td>
                <td className="td"><span className="badge bg-cyan-100 text-cyan-800">{TYPE_LABEL[s.service_type] ?? s.service_type}</span></td>
                <td className="td text-right text-slate-500">{money(s.default_cost, s.cost_currency)}</td>
                <td className="td text-right font-medium">{money(s.list_price, s.sell_currency)}</td>
                <td className="td">{s.is_active ? <span className="badge bg-green-100 text-green-700">Active</span> : <span className="badge bg-slate-100 text-slate-500">Inactive</span>}</td>
                <td className="td"><DeleteButton rpc="delete_service" paramName="p_service" id={s.id} /></td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={7}>No services yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
