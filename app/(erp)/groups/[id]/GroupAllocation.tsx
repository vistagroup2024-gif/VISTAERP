"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

interface Alloc {
  id: string;
  beds: number;
  brn_inventory: { id: string; brn: string; hotel_name: string; city: string | null; beds: number } | null;
  brn_consumption: { check_in: string; check_out: string } | null;
}

export default function GroupAllocation({
  groupId, pax, brnStatus, visaStatus, visaIssuedAt, isAdmin, allocations,
}: {
  groupId: string;
  pax: number;
  brnStatus: string;
  visaStatus: string;
  visaIssuedAt: string | null;
  isAdmin: boolean;
  allocations: Alloc[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const allocated = brnStatus === "allocated";
  const issued = visaStatus === "issued";
  const brnList = allocations.map((a) => a.brn_inventory?.brn).filter(Boolean) as string[];

  async function allocate() {
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("allocate_group_brns", { p_group: groupId });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  async function call(fn: string) {
    setBusy(true); setError(null);
    const { error } = await supabase.rpc(fn, { p_group: groupId });
    setBusy(false);
    if (error) return setError(error.message);
    router.refresh();
  }

  function copyBrns() {
    navigator.clipboard.writeText(Array.from(new Set(brnList)).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">🏨 Hotel BRN Allocation</h2>
        {issued
          ? <span className="badge bg-emerald-600 text-white">🔒 Visa Issued</span>
          : allocated
          ? <span className="badge bg-green-100 text-green-700">BRN Allocated</span>
          : <span className="badge bg-yellow-100 text-yellow-800">Pending</span>}
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!allocated ? (
        <>
          <p className="text-sm text-slate-500">
            The system automatically covers the full stay with exactly <b>one Madinah night</b> (chosen automatically for best inventory use) and Makkah for the rest — using the fewest BRNs and blocking overbooking.
          </p>
          <button className="btn" onClick={allocate} disabled={busy}>
            {busy ? "Allocating…" : `⚡ Auto Allocate (${pax} pax)`}
          </button>
        </>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">BRN</th>
                  <th className="th">Hotel</th>
                  <th className="th">City</th>
                  <th className="th">Check-in</th>
                  <th className="th">Check-out</th>
                  <th className="th text-right">Beds</th>
                </tr>
              </thead>
              <tbody>
                {allocations
                  .slice()
                  .sort((a, b) => (a.brn_consumption?.check_in ?? "").localeCompare(b.brn_consumption?.check_in ?? ""))
                  .map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="td font-mono font-medium">{a.brn_inventory?.brn}</td>
                    <td className="td">{a.brn_inventory?.hotel_name}</td>
                    <td className="td">
                      <span className={`badge ${a.brn_inventory?.city === "Madinah" ? "bg-purple-100 text-purple-700" : "bg-cyan-100 text-cyan-800"}`}>
                        {a.brn_inventory?.city ?? "—"}
                      </span>
                    </td>
                    <td className="td whitespace-nowrap">{dateStr(a.brn_consumption?.check_in)}</td>
                    <td className="td whitespace-nowrap">{dateStr(a.brn_consumption?.check_out)}</td>
                    <td className="td text-right font-medium">{a.beds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Copy BRN(s) for Nusuk Masar</p>
              <button className="btn text-sm" onClick={copyBrns}>{copied ? "✓ Copied" : "📋 Copy"}</button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-sm text-slate-800">{Array.from(new Set(brnList)).join("\n")}</pre>
          </div>

          {!issued ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <button className="btn bg-emerald-600 hover:bg-emerald-700" onClick={() => call("mark_visa_issued")} disabled={busy}>
                {busy ? "Saving…" : "✅ Mark Visa Issued"}
              </button>
              <button className="btn-outline text-sm text-red-600" onClick={() => call("deallocate_group_brns")} disabled={busy}>
                Release allocation
              </button>
              <span className="text-xs text-slate-400">Marking as issued locks the BRNs from changes.</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <span className="text-sm text-emerald-700">
                🔒 Visa issued{visaIssuedAt ? ` on ${dateStr(visaIssuedAt)}` : ""} — BRNs are locked.
              </span>
              {isAdmin && (
                <button className="btn-outline text-sm" onClick={() => call("reopen_group")} disabled={busy}>
                  Reopen (admin)
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
