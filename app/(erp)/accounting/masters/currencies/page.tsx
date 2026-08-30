import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import MasterList from "@/components/accounting/MasterList";

export const dynamic = "force-dynamic";

export default async function CurrenciesPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await sb.from("currencies").select("*").order("code");
  return (
    <div className="max-w-3xl">
      <PageHeader title="Currencies" />
      <MasterList table="currencies" pk="code" companyScoped={false} initial={(data as any[]) ?? []}
        note="Currencies and their conversion rate to the base currency (SAR). Used by multi-currency vouchers."
        fields={[
          { key: "code", label: "Code", width: "sm:col-span-1" },
          { key: "name", label: "Name", width: "sm:col-span-2" },
          { key: "symbol", label: "Symbol", width: "sm:col-span-1", required: false },
          { key: "rate_to_base", label: "Rate → SAR", type: "number", width: "sm:col-span-2", required: false },
        ]} />
    </div>
  );
}
