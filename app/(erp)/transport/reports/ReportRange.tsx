"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ReportRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  return (
    <div className="no-print mb-4 flex flex-wrap items-end gap-2">
      <div><label className="label">From</label><input type="date" className="input" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <div><label className="label">To</label><input type="date" className="input" value={t} onChange={(e) => setT(e.target.value)} /></div>
      <button className="btn text-sm" onClick={() => router.push(`/transport/reports?from=${f}&to=${t}`)}>Apply</button>
    </div>
  );
}
