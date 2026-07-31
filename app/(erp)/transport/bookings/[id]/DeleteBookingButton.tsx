"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Delete the whole booking (trips cascade) from the booking detail page, after
// an explicit confirmation, then return to the bookings list.
export default function DeleteBookingButton({ bookingId, bookingNo }: { bookingId: string; bookingNo: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function del() {
    if (!confirm(`Delete booking ${bookingNo}?\n\nThis permanently removes the booking and its trips and cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("delete_transport_booking", { p_id: bookingId });
    if (error) { setBusy(false); alert(error.message); return; }
    router.push("/transport/bookings");
    router.refresh();
  }

  return (
    <button onClick={del} disabled={busy} className="btn-outline text-red-600 hover:bg-red-50">
      {busy ? "Deleting…" : "🗑 Delete booking"}
    </button>
  );
}
