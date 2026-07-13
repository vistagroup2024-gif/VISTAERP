"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function BrnActions({ brnId, canDelete }: { brnId: string; canDelete: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    if (!confirm("Delete this BRN? This cannot be undone.")) return;
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("delete_brn", { p_brn: brnId });
    setBusy(false);
    if (error) return setError(error.message);
    router.push("/inventory/brn");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Link href={`/inventory/brn/${brnId}/edit`} className="btn-outline text-sm">Edit</Link>
        <button
          onClick={del}
          disabled={busy || !canDelete}
          title={canDelete ? "" : "Cannot delete — inventory already consumed"}
          className="btn-outline text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
