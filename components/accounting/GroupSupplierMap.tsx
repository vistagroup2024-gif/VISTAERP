"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type GC = { id: string; name: string; supplier_account_id: string | null };
type Acct = { id: string; code: string; name: string };

// Map each visa group company to its supplier ledger in the Chart of Accounts.
// The Visa auto-invoice posts the supplier cost (Dr Visa Cost / Cr this account).
export default function GroupSupplierMap({ groupCompanies, supplierAccounts }: {
  groupCompanies: GC[]; supplierAccounts: Acct[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function setAcct(gc: GC, acctId: string) {
    setErr(null); setSaving(gc.id);
    const { error } = await supabase.from("group_companies").update({ supplier_account_id: acctId || null }).eq("id", gc.id);
    setSaving(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Each visa group company posts its supplier cost to the mapped Chart-of-Accounts supplier ledger when a group is
        created. Unmapped companies post only the customer side.
      </p>
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      <div className="card p-0 text-sm">
        {groupCompanies.length === 0 ? <p className="p-4 text-slate-400">No group companies.</p> : (
          <table className="w-full">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr><th className="px-3 py-2 text-left">Group Company</th><th className="px-3 py-2 text-left">Supplier Ledger</th></tr>
            </thead>
            <tbody>
              {groupCompanies.map((gc) => (
                <tr key={gc.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-700">{gc.name}</td>
                  <td className="px-3 py-2">
                    <select className="input max-w-sm" value={gc.supplier_account_id ?? ""} disabled={saving === gc.id}
                      onChange={(e) => setAcct(gc, e.target.value)}>
                      <option value="">— none —</option>
                      {supplierAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
