import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { money } from "@/lib/format";
import CustomerRatesManager from "./CustomerRatesManager";

export const dynamic = "force-dynamic";

export default async function ServiceDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: svc } = await supabase.from("service_catalog").select("*").eq("id", params.id).single();
  if (!svc) notFound();

  const [{ data: rates }, { data: customers }] = await Promise.all([
    supabase.from("customer_rates").select("id, price, currency, parties:party_id(name)").eq("service_id", params.id),
    supabase.from("parties").select("id, name, party_type").in("party_type", ["customer", "b2b_agent"]).order("name"),
  ]);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{svc.name}</h1>
        <p className="text-slate-500 capitalize">{svc.service_type.replace("_", " ")} · {svc.code}</p>
        <p className="mt-2 text-sm">
          Cost <b>{money(svc.default_cost, svc.cost_currency)}</b> · List price <b>{money(svc.list_price, svc.sell_currency)}</b>
        </p>
      </div>
      <CustomerRatesManager
        serviceId={svc.id}
        defaultCurrency={svc.sell_currency}
        initial={(rates ?? []) as any}
        customers={customers ?? []}
      />
    </div>
  );
}
