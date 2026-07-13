"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Generic row delete: calls an RPC that takes a single uuid param.
export default function DeleteButton({
  rpc, paramName, id, label = "Delete", confirmText = "Delete this record? This cannot be undone.",
}: {
  rpc: string;
  paramName: string;
  id: string;
  label?: string;
  confirmText?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (!confirm(confirmText)) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(rpc, { [paramName]: id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={del} disabled={busy} className="text-sm text-red-600 hover:underline disabled:opacity-40">
        {busy ? "…" : label}
      </button>
      {err && <span className="text-xs text-red-600" title={err}>⚠</span>}
    </span>
  );
}
