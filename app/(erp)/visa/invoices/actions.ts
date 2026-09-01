"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Tick / untick a group's invoice-created flag.
//
// This runs on the server so the write uses the same cookie session that rendered
// the page, and so revalidatePath() drops the cached payload for this route: the
// row, the "N invoices pending" badge and the pending-only filter all come back
// from visa_invoice_ledger with the saved value instead of the client holding an
// optimistic tick that a later render could quietly undo.
export async function setVisaInvoiceCreated(groupId: string, done: boolean): Promise<{ error: string | null }> {
  const sb = createClient();
  const { error } = await sb.rpc("visa_set_invoice_created", { p_group: groupId, p_done: done });
  if (error) return { error: error.message };
  revalidatePath("/visa/invoices");
  return { error: null };
}
