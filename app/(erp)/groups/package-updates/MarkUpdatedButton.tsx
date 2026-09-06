"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Two ways to finish a package update, and they are different actions rather
// than one action with the check turned off:
//
//   normal  mark_package_updated        — the end of the allocation flow. Refuses
//                                         unless the stay is actually covered.
//   manual  mark_package_updated_manual — the override. Moves the status and
//                                         nothing else: no BRN is allocated, no
//                                         inventory is touched, and history
//                                         records that a person did it by hand.
export default function MarkUpdatedButton({ groupId, manual }: { groupId: string; manual?: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function mark() {
    const ok = confirm(manual
      ? "Mark this package updated manually?\n\nThe status changes to Updated. No BRN is allocated and no inventory is touched — use this when the package was updated in Nusuk without being covered from this system's inventory."
      : "Mark this package as updated in Nusuk?");
    if (!ok) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(manual ? "mark_package_updated_manual" : "mark_package_updated", { p_group: groupId });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button onClick={mark} disabled={busy} title={manual ? "Change the status only — allocates nothing" : undefined}
        className={`rounded px-2 py-0.5 text-xs font-medium disabled:opacity-40 ${
          manual
            ? "border border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-800"
            : "bg-blue-600 text-white hover:bg-blue-700"}`}>
        {busy ? "…" : manual ? "Mark Updated (manual)" : "Mark Updated"}
      </button>
      {err && <span className="text-xs text-red-600" title={err}>⚠</span>}
    </span>
  );
}
