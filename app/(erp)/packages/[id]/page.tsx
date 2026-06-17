import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PackageDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: pkg } = await supabase.from("packages").select("*").eq("id", params.id).single();
  if (!pkg) notFound();

  const { data: items } = await supabase
    .from("package_items")
    .select("*")
    .eq("package_id", params.id)
    .order("sort_order");

  const totalSell = (items ?? []).reduce((s, i) => s + Number(i.sell_price) * Number(i.qty), 0);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{pkg.name}</h1>
        <p className="text-slate-500">{pkg.description}</p>
      </div>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Service</th>
              <th className="th">Description</th>
              <th className="th text-right">Cost</th>
              <th className="th text-right">Sell</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id} className="border-t border-slate-100">
                <td className="td capitalize">{i.service_type.replace("_", " ")}</td>
                <td className="td">{i.description}</td>
                <td className="td text-right text-slate-500">{money(i.cost_price, i.cost_currency)}</td>
                <td className="td text-right font-medium">{money(i.sell_price, i.sell_currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50">
              <td className="td font-semibold" colSpan={3}>Package price (per pax)</td>
              <td className="td text-right font-bold">{money(totalSell, pkg.base_currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
