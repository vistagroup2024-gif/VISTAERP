"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID } from "@/lib/format";

export default function AddCompany() {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError(null);
    const { error } = await supabase.from("group_companies").insert({ company_id: COMPANY_ID, name: name.trim() });
    setBusy(false);
    if (error) return setError(error.message);
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={add} className="card flex flex-wrap items-end gap-3">
      <div className="flex-1">
        <label className="label">Company name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vista Travels (Pvt) Ltd" required />
      </div>
      <button className="btn" disabled={busy}>{busy ? "Adding…" : "+ Add company"}</button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
