"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Shown on a cancelled booking's voucher only. Deletes the booking (trips
// cascade) after an explicit confirmation, then returns to the bookings list.
export default function DeleteVoucherButton({ bookingId, bookingNo }: { bookingId: string; bookingNo: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`Delete voucher for cancelled booking ${bookingNo}?\n\nThis permanently removes the booking and its trips and cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_transport_booking", { p_id: bookingId });
    if (error) { setBusy(false); alert(error.message); return; }
    router.push("/transport/bookings");
    router.refresh();
  }

  return (
    <button onClick={del} disabled={busy} className="btn-outline text-sm text-red-600 hover:bg-red-50">
      {busy ? "Deleting…" : "🗑 Delete voucher"}
    </button>
  );
}
