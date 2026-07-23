"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ChangePassword({ token }: { token: string }) {
  const supabase = createClient();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirm) { setMsg({ ok: false, text: "New passwords do not match" }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("b2b_change_password", { p_token: token, p_old: oldPw, p_new: newPw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setOldPw(""); setNewPw(""); setConfirm("");
    setMsg({ ok: true, text: "Password changed successfully." });
  }

  return (
    <form onSubmit={submit} className="max-w-sm space-y-3 rounded-xl bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-700">Change Password</h2>
      {msg && <div className={`rounded px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
      <div><label className="label">Current password</label>
        <input className="input" type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required /></div>
      <div><label className="label">New password</label>
        <input className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required /></div>
      <div><label className="label">Confirm new password</label>
        <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
      <button className="btn" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
    </form>
  );
}
