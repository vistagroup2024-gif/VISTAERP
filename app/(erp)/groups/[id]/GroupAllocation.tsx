"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dateStr } from "@/lib/format";

interface Alloc {
  id: string;
  beds: number;
  locked: boolean;
  brn_inventory: { id: string; brn: string; hotel_name: string; city: string | null; beds: number } | null;
  brn_consumption: { check_in: string; check_out: string } | null;
}

export default function GroupAllocation({
  groupId, pax, brnStatus, visaStatus, visaIssuedAt, isAdmin, workflowStatus, brnAvailability, brnWhy, packageStatus, allocations,
}: {
  groupId: string;
  pax: number;
  brnStatus: string;
  visaStatus: string;
  visaIssuedAt: string | null;
  isAdmin: boolean;
  workflowStatus: string;
  brnAvailability?: string | null;
  brnWhy?: {
    pax: number; nights_needed: number; group_company: string | null;
    best_night_free: number; worst_night_free: number;
    covered_nights: number; covered_from: string | null; covered_to: string | null;
  } | null;
  packageStatus: string | null;
  allocations: Alloc[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [options, setOptions] = useState<any[]>([]);
  // Manual BRN add.
  const [manualOpen, setManualOpen] = useState(false);
  const [avail, setAvail] = useState<any[]>([]);
  const [mBrn, setMBrn] = useState("");
  const [mFrom, setMFrom] = useState("");
  const [mTo, setMTo] = useState("");
  const [mBeds, setMBeds] = useState(String(pax));

  const allocated = brnStatus === "allocated";
  const issued = visaStatus === "issued";
  const brnList = allocations.map((a) => a.brn_inventory?.brn).filter(Boolean) as string[];
  const sortedAllocs = [...allocations].sort((a, b) => (a.brn_consumption?.check_in ?? "").localeCompare(b.brn_consumption?.check_in ?? ""));
  const latestId = sortedAllocs.length ? sortedAllocs[sortedAllocs.length - 1].id : null; // LIFO: only the latest may be removed

  async function rpc(fn: string, args: any, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return setError(error.message);
    if (fn === "update_package_brns" && data === "partial")
      setError("Some remaining nights still have no single BRN available — purchase inventory and run Update Package again.");
    router.refresh();
  }

  async function openReplace(allocId: string) {
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("list_replacement_brns", { p_alloc: allocId });
    setBusy(false);
    if (error) return setError(error.message);
    setOptions((data ?? []).filter((o: any) => o.available >= pax));
    setReplaceFor(allocId);
  }
  async function doReplace(brnId: string) {
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("replace_group_brn", { p_alloc: replaceFor, p_new_brn: brnId });
    setBusy(false);
    if (error) return setError(error.message);
    setReplaceFor(null); setOptions([]);
    router.refresh();
  }

  async function openManual() {
    setBusy(true); setError(null);
    const { data, error } = await supabase.rpc("list_group_available_brns", { p_group: groupId });
    setBusy(false);
    if (error) return setError(error.message);
    setAvail((data ?? []).filter((o: any) => o.available > 0));
    setManualOpen(true);
  }
  function pickManualBrn(id: string) {
    setMBrn(id);
    const b = avail.find((x) => x.id === id);
    if (b) { setMFrom(b.check_in); setMTo(b.check_out); }
  }
  async function addManual() {
    if (!mBrn || !mFrom || !mTo) { setError("Select a BRN and the check-in / check-out dates."); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.rpc("add_group_brn", { p_group: groupId, p_brn: mBrn, p_check_in: mFrom, p_check_out: mTo, p_beds: Number(mBeds) || pax });
    setBusy(false);
    if (error) return setError(error.message);
    setManualOpen(false); setMBrn(""); setMFrom(""); setMTo(""); setAvail([]);
    router.refresh();
  }

  function copyBrns() {
    navigator.clipboard.writeText(Array.from(new Set(brnList)).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Manual add-BRN panel — available while processing or allocated (not issued).
  const manualPanel = !issued ? (
    <div className="border-t border-slate-100 pt-4">
      {!manualOpen ? (
        <button className="btn-outline text-sm" disabled={busy} onClick={openManual}>➕ Add BRN manually</button>
      ) : (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Add a BRN from available inventory</p>
            <button className="text-sm text-slate-500 hover:underline" onClick={() => { setManualOpen(false); setAvail([]); setMBrn(""); }}>Cancel</button>
          </div>
          {avail.length === 0 ? (
            <p className="text-sm text-slate-500">No BRN inventory with availability for this company.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="lg:col-span-2"><label className="label">BRN</label>
                  <select className="input" value={mBrn} onChange={(e) => pickManualBrn(e.target.value)}>
                    <option value="">Choose a BRN…</option>
                    {avail.map((o) => <option key={o.id} value={o.id}>{o.brn} · {o.hotel_name} · {o.city} ({dateStr(o.check_in)}–{dateStr(o.check_out)}, {o.available} beds)</option>)}
                  </select></div>
                <div><label className="label">Check-in</label><input type="date" className="input" value={mFrom} onChange={(e) => setMFrom(e.target.value)} /></div>
                <div><label className="label">Check-out</label><input type="date" className="input" value={mTo} onChange={(e) => setMTo(e.target.value)} /></div>
                <div><label className="label">Beds</label><input type="number" min="1" className="input" value={mBeds} onChange={(e) => setMBeds(e.target.value)} /></div>
                <div className="flex items-end lg:col-span-5"><button className="btn" disabled={busy || !mBrn} onClick={addManual}>{busy ? "Adding…" : "Add BRN"}</button></div>
              </div>
              <p className="text-xs text-slate-500">Pick the exact nights — check-out is the morning after the last night (e.g. one Madinah night 12→13 Aug). Availability is validated on the tightest night.</p>
            </>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-700">🏨 Hotel BRN Allocation</h2>
        <div className="flex items-center gap-2">
          {issued
            ? <span className="badge bg-emerald-600 text-white">🔒 Visa Issued</span>
            : allocated
            ? <span className="badge bg-green-100 text-green-700">BRN Allocated</span>
            : <span className="badge bg-yellow-100 text-yellow-800">Pending</span>}
          {allocated && (
            <button className="btn-outline text-sm" disabled={busy}
              onClick={() => rpc("reallocate_all_brns", { p_group: groupId }, "Release ALL BRNs and rebuild the allocation from scratch?")}>
              ♻️ Reallocate All BRNs
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{error}</div>}

      {!allocated ? (
        workflowStatus !== "process" ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Choose <b>Process</b> in the Visa Workflow above before allocating BRNs.
          </p>
        ) : (
        <>
          {brnAvailability === "complete" && <div className="rounded-lg bg-teal-50 px-4 py-2 text-sm font-medium text-teal-800">✅ Ready to Allocate — full BRN coverage is available.</div>}
          {brnAvailability === "partial" && (
            <div className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
              <div className="font-medium">🟡 Ready to Allocate (partial) — the package will be flagged for update.</div>
              {brnWhy && brnWhy.covered_nights > 0 && (
                <div className="mt-1 text-[13px]">
                  {brnWhy.pax} beds are free for <b>{brnWhy.covered_nights}</b> of {brnWhy.nights_needed} nights
                  {brnWhy.covered_from && <> ({dateStr(brnWhy.covered_from)} – {dateStr(brnWhy.covered_to)})</>}.
                </div>
              )}
            </div>
          )}
          {brnAvailability === "none" && (
            <div className="rounded-lg bg-orange-50 px-4 py-2 text-sm text-orange-800">
              <div className="font-medium">⏳ Waiting BRN — no allocatable coverage yet.</div>
              {brnWhy && (
                <div className="mt-1 text-[13px]">
                  This group needs <b>{brnWhy.pax} beds</b> for <b>{brnWhy.nights_needed} nights</b>.
                  {brnWhy.group_company ? <> Across those dates <b>{brnWhy.group_company}</b> has</> : <> Across those dates this company has</>}
                  {" "}at most <b>{brnWhy.best_night_free}</b> free on any one night
                  {brnWhy.best_night_free > 0 && brnWhy.best_night_free < brnWhy.pax
                    ? <> — {brnWhy.pax - brnWhy.best_night_free} short even on its best night.</>
                    : <>.</>}
                  {" "}Beds held by another group company cannot be used here.
                </div>
              )}
            </div>
          )}
          <p className="text-sm text-slate-500">
            Auto-allocation covers the full stay with one Madinah night when possible; otherwise it falls back to partial coverage (min 3 nights) and flags the package for update.
          </p>
          <button className="btn" onClick={() => rpc("allocate_group_brns", { p_group: groupId })} disabled={busy}>
            {busy ? "Allocating…" : `⚡ Auto Allocate (${pax} pax)`}
          </button>
          {manualPanel}
        </>
        )
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">BRN</th><th className="th">Hotel</th><th className="th">City</th>
                  <th className="th">Check-in</th><th className="th">Check-out</th><th className="th">Beds</th><th className="th">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAllocs.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="td font-mono font-medium">{a.brn_inventory?.brn} {a.locked && <span title="Submitted to Nusuk — locked">🔒</span>}</td>
                    <td className="td">{a.brn_inventory?.hotel_name}</td>
                    <td className="td">
                      <span className={`badge ${a.brn_inventory?.city === "Madinah" ? "bg-purple-100 text-purple-700" : "bg-cyan-100 text-cyan-800"}`}>
                        {a.brn_inventory?.city ?? "—"}
                      </span>
                    </td>
                    <td className="td whitespace-nowrap">{dateStr(a.brn_consumption?.check_in)}</td>
                    <td className="td whitespace-nowrap">{dateStr(a.brn_consumption?.check_out)}</td>
                    <td className="td font-medium">{a.beds}</td>
                    <td className="td whitespace-nowrap">
                      {a.locked ? (
                        <span className="text-sm text-slate-400">Locked (Nusuk)</span>
                      ) : (
                        <>
                          <button className="text-sm text-brand hover:underline" disabled={busy}
                            onClick={() => rpc("reallocate_group_brn", { p_alloc: a.id }, "Replace this BRN with the best available alternative for the same nights?")}>
                            Reallocate
                          </button>
                          <button className="ml-3 text-sm text-purple-600 hover:underline" disabled={busy}
                            onClick={() => openReplace(a.id)}>
                            Replace Hotel
                          </button>
                          <button className="ml-3 text-sm text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                            disabled={busy || a.id !== latestId}
                            title={a.id === latestId ? "" : "Remove the latest BRN first (LIFO)"}
                            onClick={() => rpc("remove_group_brn", { p_alloc: a.id }, "Remove this BRN and restore its inventory?")}>
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {replaceFor && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-purple-800">Replace Hotel Allocation — pick any BRN (Makkah or Madinah) for the same nights</p>
                <button className="text-sm text-slate-500 hover:underline" onClick={() => { setReplaceFor(null); setOptions([]); }}>Cancel</button>
              </div>
              {options.length === 0 ? (
                <p className="text-sm text-slate-500">No alternative BRN has enough beds for those nights.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-white/60"><tr><th className="th">BRN</th><th className="th">Hotel</th><th className="th">City</th><th className="th">Available</th><th className="th"></th></tr></thead>
                    <tbody>
                      {options.map((o) => (
                        <tr key={o.id} className="border-t border-purple-100">
                          <td className="td font-mono">{o.brn}</td>
                          <td className="td">{o.hotel_name}</td>
                          <td className="td"><span className={`badge ${o.city === "Madinah" ? "bg-purple-100 text-purple-700" : "bg-cyan-100 text-cyan-800"}`}>{o.city}</span></td>
                          <td className="td">{o.available}</td>
                          <td className="td"><button className="btn text-sm" disabled={busy} onClick={() => doReplace(o.id)}>Use this</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {packageStatus === "update_ready" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">✅ All nights covered — package is ready for the Nusuk update</p>
              <p className="mt-1 text-sm text-amber-700">Update the package in Nusuk, then confirm here. This group stays in the Package Update queue until you confirm.</p>
              <button className="btn mt-2 bg-blue-600 hover:bg-blue-700" onClick={() => rpc("mark_package_updated", { p_group: groupId })} disabled={busy}>
                {busy ? "Saving…" : "✔ Mark Package Updated"}
              </button>
            </div>
          )}

          {(packageStatus === "update_required" || packageStatus === "update_available") && (
            <div className={`rounded-lg border p-4 ${packageStatus === "update_available" ? "border-teal-200 bg-teal-50" : "border-orange-200 bg-orange-50"}`}>
              <p className={`text-sm font-semibold ${packageStatus === "update_available" ? "text-teal-800" : "text-orange-800"}`}>
                {packageStatus === "update_available" ? "🔔 Inventory available — ready for package update" : "🔄 Partial package — update required (awaiting inventory)"}
              </p>
              <p className="mt-1 text-sm text-slate-600">Auto-allocate BRN(s) for the remaining uncovered nights. Existing BRNs are kept.</p>
              <button className={`btn mt-2 ${packageStatus === "update_available" ? "bg-teal-600 hover:bg-teal-700" : "bg-orange-600 hover:bg-orange-700"}`}
                onClick={() => rpc("update_package_brns", { p_group: groupId })} disabled={busy || packageStatus === "update_required"}
                title={packageStatus === "update_required" ? "No single-BRN inventory available yet for the remaining nights" : ""}>
                {busy ? "Updating…" : "🔄 Update Package (allocate remaining nights)"}
              </button>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Copy BRN(s) for Nusuk Masar</p>
              <button className="btn text-sm" onClick={copyBrns}>{copied ? "✓ Copied" : "📋 Copy"}</button>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-sm text-slate-800">{Array.from(new Set(brnList)).join("\n")}</pre>
          </div>

          {manualPanel}

          {!issued ? (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <button className="btn-outline text-sm text-red-600" onClick={() => rpc("deallocate_group_brns", { p_group: groupId }, "Release the full allocation?")} disabled={busy}>
                Release allocation
              </button>
              <span className="text-xs text-slate-400">Use the Visa Workflow above to advance the group through each stage.</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <span className="text-sm text-emerald-700">
                🔒 Visa issued{visaIssuedAt ? ` on ${dateStr(visaIssuedAt)}` : ""}. Hotel/BRN updates are still allowed above.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
