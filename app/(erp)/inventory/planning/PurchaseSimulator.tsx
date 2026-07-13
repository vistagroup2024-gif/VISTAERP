"use client";

import { useMemo, useState } from "react";
import { DayDemand, simulate } from "@/lib/planning";

export default function PurchaseSimulator({ demand }: { demand: DayDemand[] }) {
  const first = demand[0]?.date ?? "";
  const last = demand[demand.length - 1]?.date ?? "";
  const [beds, setBeds] = useState(50);
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);

  const result = useMemo(() => {
    if (!from || !to || to <= from || beds <= 0) return null;
    return simulate(demand, Number(beds), from, to);
  }, [demand, beds, from, to]);

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold text-slate-700">🧪 Purchase Simulation</h2>
      <p className="text-sm text-slate-500">Model a hotel offer before committing — see instantly how much shortage it removes and how many beds go unused.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label">Beds</label>
          <input className="input" type="number" min={1} value={beds} onChange={(e) => setBeds(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">From</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To (checkout)</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {result && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-400">Shortage before</p>
            <p className="text-xl font-bold">{result.shortageBefore}</p>
          </div>
          <div className="rounded-lg bg-green-50 p-3">
            <p className="text-xs text-slate-400">Shortage removed</p>
            <p className="text-xl font-bold text-green-700">{result.reduced}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs text-slate-400">Remaining shortage</p>
            <p className={`text-xl font-bold ${result.remainingShortage > 0 ? "text-red-600" : "text-green-700"}`}>{result.remainingShortage}</p>
          </div>
          <div className="rounded-lg bg-yellow-50 p-3">
            <p className="text-xs text-slate-400">Unused beds (waste)</p>
            <p className="text-xl font-bold text-yellow-700">{result.unusedBeds}</p>
          </div>
        </div>
      )}
    </div>
  );
}
