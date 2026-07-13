import { createClient } from "@/lib/supabase/server";
import ConsumeForm from "./ConsumeForm";
import { Brn } from "@/lib/brn";

export const dynamic = "force-dynamic";

export default async function ConsumePage({ searchParams }: { searchParams: { brn?: string } }) {
  const supabase = createClient();
  const [{ data: brns }, { data: cons }] = await Promise.all([
    supabase.from("brn_inventory").select("*").order("hotel_name"),
    supabase.from("brn_consumption").select("id, brn_id, reference, check_in, check_out, beds"),
  ]);

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">Consume Inventory</h1>
      <p className="mb-6 text-sm text-slate-500">
        Assign beds from a BRN to a Nusuk Masar package. Availability is checked for every night — overbooking is blocked.
      </p>
      <ConsumeForm
        brns={(brns ?? []) as Brn[]}
        cons={(cons ?? []) as any[]}
        preselect={searchParams.brn ?? ""}
      />
    </div>
  );
}
