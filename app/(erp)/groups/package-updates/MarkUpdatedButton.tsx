"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function MarkUpdatedButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function mark() {
    if (!confirm("Mark this package as updated in Nusuk?")) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("mark_package_updated", { p_group: groupId });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={mark} disabled={busy}
        className="rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">
        {busy ? "…" : "Mark Updated"}
      </button>
      {err && <span className="text-xs text-red-600" title={err}>⚠</span>}
    </span>
  );
}
