"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Tick / untick a trip's invoice-created flag.
//
// Same shape as the Visa Invoices action, and for the same reason: the write runs
// on the server with the session that rendered the page, and revalidatePath()
// drops this route's cached payload so the row comes back from
// transport_trip_ledger with the SAVED value — not an optimistic tick the next
// render could quietly undo.
export async function setTripInvoiceCreated(tripId: string, done: boolean): Promise<{ error: string | null }> {
  const sb = createClient();
  const { error } = await sb.rpc("transport_set_invoice_created", { p_trip: tripId, p_done: done });
  if (error) return { error: error.message };
  revalidatePath("/transport/reports/ledger");
  return { error: null };
}
