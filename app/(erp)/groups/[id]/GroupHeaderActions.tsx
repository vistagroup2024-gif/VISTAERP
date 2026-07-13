"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GroupHeaderActions({
  groupId, brnStatus, visaStatus, isAdmin,
}: { groupId: string; brnStatus: string; visaStatus: string; isAdmin: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issued = visaStatus === "issued";
  const allocated = brnStatus === "allocated";
  const canEdit = isAdmin || !issued;
  const canDelete = !issued && !allocated;

  async function del() {
    if (!confirm("Delete this group? This cannot be undone.")) return;
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("delete_group", { p_group: groupId });
    setBusy(false);
    if (error) return setError(error.message);
    router.push("/groups");
    router.refresh();
  }

  async function forceDelete() {
    const reason = prompt("Super Admin force-delete. Enter a reason (recorded in the audit log):");
    if (reason === null) return;
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("admin_delete_group", { p_group: groupId, p_reason: reason });
    setBusy(false);
    if (error) return setError(error.message);
    router.push("/groups");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Link href="/groups" className="btn-outline text-sm">← All groups</Link>
        {canEdit && <Link href={`/groups/${groupId}/edit`} className="btn-outline text-sm">Edit</Link>}
        {canDelete && (
          <button onClick={del} disabled={busy} className="btn-outline text-sm text-red-600">
            {busy ? "…" : "Delete"}
          </button>
        )}
        {isAdmin && (issued || allocated) && (
          <button onClick={forceDelete} disabled={busy} className="btn-outline text-sm text-red-600">
            {busy ? "…" : "Force delete (admin)"}
          </button>
        )}
      </div>
      {error && <span className="max-w-xs text-right text-xs text-red-600">{error}</span>}
    </div>
  );
}
