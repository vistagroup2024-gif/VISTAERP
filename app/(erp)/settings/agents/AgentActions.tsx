"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AgentActions({ id, status, locked }: { id: string; status: string; locked: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function update(patch: any) {
    setBusy(true);
    await supabase.from("b2b_agents").update(patch).eq("id", id);
    setBusy(false);
    router.refresh();
  }
  async function del() {
    if (!confirm("Delete this agent account?")) return;
    setBusy(true);
    await supabase.rpc("delete_b2b_agent", { p_id: id });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link href={`/settings/agents/${id}/edit`} className="text-brand hover:underline">Edit</Link>
      <button disabled={busy} onClick={() => update({ status: status === "active" ? "inactive" : "active" })} className="text-slate-600 hover:underline">
        {status === "active" ? "Deactivate" : "Activate"}
      </button>
      <button disabled={busy} onClick={() => update({ locked: !locked })} className="text-slate-600 hover:underline">
        {locked ? "Unlock" : "Lock"}
      </button>
      <button disabled={busy} onClick={del} className="text-red-600 hover:underline">Delete</button>
    </div>
  );
}
