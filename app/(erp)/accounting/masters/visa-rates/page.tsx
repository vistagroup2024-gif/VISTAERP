import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import ProductRatesManager from "@/components/accounting/ProductRatesManager";

export const dynamic = "force-dynamic";

export default async function VisaRatesPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const [prod, cust, sup, cr, sr] = await Promise.all([
    sb.from("acct_products").select("id, name, purchase_rate, sell_rate").eq("is_group", false).eq("is_active", true).order("name"),
    sb.from("parties").select("id, name").in("party_type", ["customer", "b2b_agent"]).eq("is_active", true).order("name"),
    sb.from("accounts").select("id, name, code").eq("is_postable", true).eq("is_group", false).like("code", "2-01-%").order("code"),
    sb.from("product_customer_rates").select("id, product_id, party_id, sell_rate"),
    sb.from("product_supplier_rates").select("id, product_id, account_id, purchase_rate"),
  ]);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Visa Rates" />
      <ProductRatesManager
        products={(prod.data as any[]) ?? []}
        customers={(cust.data as any[]) ?? []}
        suppliers={(sup.data as any[]) ?? []}
        custRates={(cr.data as any[]) ?? []}
        supRates={(sr.data as any[]) ?? []} />
    </div>
  );
}
