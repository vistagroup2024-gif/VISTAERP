"use client";

import { useState } from "react";

export default function WhatsAppDiag() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [to, setTo] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function check() {
    setLoading(true); setInfo(null);
    const res = await fetch("/api/transport/whatsapp/diag");
    setInfo(await res.json().catch(() => ({ error: "Could not read response" })));
    setLoading(false);
  }
  async function sendTest() {
    if (!to.trim()) return;
    setTesting(true); setTestMsg(null);
    const res = await fetch("/api/transport/whatsapp/diag", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to }) });
    const j = await res.json().catch(() => ({}));
    setTesting(false);
    setTestMsg(j.ok ? `✅ Sent (id ${j.id ?? "—"})` : `❌ ${j.error || "Failed"}`);
  }

  return (
    <div className="card mb-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">WhatsApp connection</h2>
        <button onClick={() => { setOpen((o) => !o); if (!info) check(); }} className="btn-outline text-sm">{open ? "Hide" : "Check connection"}</button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 text-sm">
          {loading && <p className="text-slate-500">Checking…</p>}
          {info && (
            <>
              <div className={`rounded-md px-3 py-2 ${info.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
                {info.ok
                  ? <>Connected to <b>{info.verifiedName ?? "—"}</b> · {info.displayPhoneNumber ?? "—"} (quality: {info.qualityRating ?? "n/a"}).</>
                  : <>Not working: {info.error}{info.metaCode ? ` (code ${info.metaCode})` : ""}</>}
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-slate-600">
                <dt className="text-slate-400">Active Phone number ID</dt><dd className="font-mono">{info.phoneNumberId ?? "— not set —"}</dd>
                <dt className="text-slate-400">Token</dt><dd>{info.tokenSet ? `set (…${info.tokenLast4})` : "— not set —"}</dd>
                <dt className="text-slate-400">API version</dt><dd>{info.apiVersion}</dd>
                <dt className="text-slate-400">Template</dt><dd>{info.template ? `${info.template} (${info.templateLang})` : "none (plain text — 24h window only)"}</dd>
              </dl>
              <p className="text-xs text-slate-400">Confirm the “Active Phone number ID” above matches the new one you set in Meta. If it still shows the old value, the environment variable didn’t redeploy.</p>

              <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <div>
                  <label className="label">Send a test to (WhatsApp number)</label>
                  <input className="input max-w-[16rem]" placeholder="9665XXXXXXXX" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <button onClick={sendTest} disabled={testing || !to.trim()} className="btn text-sm">{testing ? "Sending…" : "Send test"}</button>
                {testMsg && <span className="text-sm">{testMsg}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
