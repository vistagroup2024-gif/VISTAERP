"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Opt = { id: string; code: string; name: string };

// Account + date-range picker that drives the ledger via query params (GET).
export default function LedgerControls({ accounts, account, from, to }: {
  accounts: Opt[]; account: string; from: string; to: string;
}) {
  const router = useRouter();
  const [a, setA] = useState(account);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  function run() {
    const p = new URLSearchParams();
    if (a) p.set("account", a);
    if (f) p.set("from", f);
    if (t) p.set("to", t);
    router.push(`/accounting/ledger?${p.toString()}`);
  }

  return (
    <div className="card flex flex-wrap items-end gap-3">
      <div className="min-w-[240px] flex-1">
        <label className="label">Account</label>
        <select className="input" value={a} onChange={(e) => setA(e.target.value)}>
          <option value="">— select account —</option>
          {accounts.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.name}</option>)}
        </select>
      </div>
      <div><label className="label">From</label><input type="date" className="input" value={f} onChange={(e) => setF(e.target.value)} /></div>
      <div><label className="label">To</label><input type="date" className="input" value={t} onChange={(e) => setT(e.target.value)} /></div>
      <button onClick={run} className="btn">Run</button>
    </div>
  );
}
