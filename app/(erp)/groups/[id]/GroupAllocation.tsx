"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

interface Alloc {
  id: string;
  beds: number;
  brn_inventory: { id: string; brn: string; hotel_name: string; beds: number; check_in: string; check_out: string } | null;
}

export default function GroupAllocation({
  groupId, pax, brnStatus, allocations,
}: {
  groupId: string;
  pax: number;
  brnStatus: string;
  allocations: Alloc[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const allocated = brnStatus === "allocated";
  const brnList = allocations.map((a) => a.brn_inventory?.brn).filter(Boolean) as string[];

  async function allocate() {
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("allocate_group_brns", { p_group: groupId });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  async function deallocate() {
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("deallocate_group_brns", { p_group: groupId });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  function copyBrns() {
    navigator.clipboard.writeText(brnList.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">🏨 Hotel BRN Allocation</h2>
        {allocated
          ? <span className="badge bg-green-100 text-green-700">Allocated</span>
          : <span className="badge bg-yellow-100 text-yellow-800">Pending</span>}
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!allocated ? (
        <>
          <p className="text-sm text-slate-500">
            The system will automatically find BRN(s) with enough beds for all {pax} pilgrims across the full stay and consume only what’s needed.
          </p>
          <button className="btn" onClick={allocate} disabled={busy}>
            {busy ? "Allocating…" : `⚡ Auto-allocate BRNs for ${pax} pax`}
          </button>
        </>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">BRN</th>
                  <th className="th">Hotel</th>
                  <th className="th">Coverage</th>
                  <th className="th text-right">Beds used</th>
                  <th className="th text-right">BRN total</th>
                </tr>
              </thead>
              <tbody>
                {allocations.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="td font-mono font-medium">{a.brn_inventory?.brn}</td>
                    <td className="td">{a.brn_inventory?.hotel_name}</td>
                    <td className="td text-sm text-slate-500">
                      {a.brn_inventory ? `${dateStr(a.brn_inventory.check_in)} → ${dateStr(a.brn_inventory.check_out)}` : "—"}
                    </td>
                    <td className="td text-right font-medium">{a.beds}</td>
                    <td className="td text-right text-slate-500">{a.brn_inventory?.beds}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="td" colSpan={3}>Total allocated</td>
                  <td className="td text-right">{allocations.reduce((s, a) => s + a.beds, 0)} / {pax}</td>
                  <td className="td"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Copy BRN(s) for Nusuk Masar</p>
              <button className="btn text-sm" onClick={copyBrns}>{copied ? "✓ Copied" : "📋 Copy"}</button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-sm text-slate-800">{brnList.join("\n")}</pre>
          </div>

          <button className="btn-outline text-sm text-red-600" onClick={deallocate} disabled={busy}>
            {busy ? "Releasing…" : "Release allocation"}
          </button>
        </>
      )}
    </div>
  );
}
