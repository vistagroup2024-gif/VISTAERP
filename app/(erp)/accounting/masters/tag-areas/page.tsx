import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import TreeMaster from "@/components/accounting/TreeMaster";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

export const dynamic = "force-dynamic";

export default async function TagAreasPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data } = await fetchAllRows<any>((from, to) =>
    sb.from("acct_tag_areas")
      .select("id, parent_id, name, is_group, is_active, sort, car_authorization_expiry, car_insurance_expiry, operation_card_expiry, fahas_expiry")
      .order("id").range(from, to));
  return (
    <div>
      <PageHeader title="Tag Areas" />
      <TreeMaster table="acct_tag_areas" initial={data ?? []}
        extras={[
          { key: "car_authorization_expiry", label: "Car Authorization", type: "date" },
          { key: "car_insurance_expiry", label: "Car Insurance", type: "date" },
          { key: "operation_card_expiry", label: "Operation Card", type: "date" },
          { key: "fahas_expiry", label: "Fahas (Inspection)", type: "date" },
        ]}
        note="A second free dimension you can tag on voucher lines (e.g. project, region, campaign). Group them as needed. A vehicle leaf (under VEHICLES) can also carry its compliance expiry dates — read on the Compliance Portal." />
    </div>
  );
}
