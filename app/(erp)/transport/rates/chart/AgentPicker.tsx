"use client";

import { useRouter } from "next/navigation";

interface Party { party_id: string; name: string; has_login: boolean; has_own_rates: boolean }

// Choosing an agent reloads the page rather than fetching in the browser, so the
// chart on screen is always one the server resolved — and the URL names it, which
// makes a particular agent's chart something you can send to somebody.
export default function AgentPicker({ parties, agent, on }: { parties: Party[]; agent: string | null; on: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  function go(next: { agent?: string | null; on?: string }) {
    const a = next.agent !== undefined ? next.agent : agent;
    const d = next.on !== undefined ? next.on : on;
    const q = new URLSearchParams();
    if (a) q.set("agent", a);
    if (d && d !== today) q.set("on", d);
    router.push(`/transport/rates/chart${q.toString() ? `?${q}` : ""}`);
  }

  return (
    <div className="no-print mb-4 flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Agent</span>
        <select className="input min-w-[16rem]" value={agent ?? ""} onChange={(e) => go({ agent: e.target.value || null })}>
          <option value="">Standard rate — no agent</option>
          {parties.map((p) => (
            <option key={p.party_id} value={p.party_id}>
              {p.name}
              {p.has_own_rates ? " ★" : ""}
              {p.has_login ? "" : " (no login)"}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">As on</span>
        <input type="date" className="input" value={on || today} onChange={(e) => go({ on: e.target.value || today })} />
      </label>
      <p className="pb-2 text-xs text-slate-400">★ has rates of its own · rates are effective-dated, so the date decides which apply</p>
    </div>
  );
}
