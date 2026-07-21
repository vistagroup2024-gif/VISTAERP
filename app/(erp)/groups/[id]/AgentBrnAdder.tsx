"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AgentBrnAdder({ groupId }: { groupId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [row, setRow] = useState({ brn: "", city: "Makkah", hotel: "", check_in: "", check_out: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    if (!row.brn.trim() || !row.check_in || !row.check_out) { setErr("BRN and dates are required"); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("add_agent_brn", {
      p_group: groupId, p_brn: row.brn.trim(), p_city: row.city, p_hotel: row.hotel.trim() || row.brn.trim(),
      p_check_in: row.check_in, p_check_out: row.check_out,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setRow({ brn: "", city: "Makkah", hotel: "", check_in: "", check_out: "" });
    router.refresh();
  }
  async function option(opt: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("set_masar_option", { p_group: groupId, p_option: opt });
    setBusy(false);
    if (error) return setErr(error.message);
    router.refresh();
  }

  return (
    <div className="card space-y-3 border border-amber-200 bg-amber-50">
      <h2 className="font-semibold text-amber-800">🧳 Agent BRNs pending — add more provided BRNs</h2>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <input className="input" placeholder="BRN" value={row.brn} onChange={(e) => setRow({ ...row, brn: e.target.value })} />
        <select className="input" value={row.city} onChange={(e) => setRow({ ...row, city: e.target.value })}>
          <option>Makkah</option><option>Madinah</option><option>Jeddah</option>
        </select>
        <input className="input" placeholder="Hotel" value={row.hotel} onChange={(e) => setRow({ ...row, hotel: e.target.value })} />
        <input className="input" type="date" value={row.check_in} onChange={(e) => setRow({ ...row, check_in: e.target.value })} />
        <input className="input" type="date" min={row.check_in || undefined} value={row.check_out} onChange={(e) => setRow({ ...row, check_out: e.target.value })} />
        <button className="btn text-sm" disabled={busy} onClick={add}>Add BRN</button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-amber-200 pt-3">
        <button className="btn text-sm" disabled={busy} onClick={() => option("vista")}>Done — Vista allocates the remaining nights</button>
        <button className="btn-outline text-sm" disabled={busy} onClick={() => option("later")}>Keep pending — agent will send more</button>
      </div>
    </div>
  );
}
