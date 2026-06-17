"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { COMPANY_ID, money } from "@/lib/format";

export default function InvoiceActions({
  invoiceId,
  currency,
  balance,
}: {
  invoiceId: string;
  currency: string;
  balance: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [amount, setAmount] = useState(balance);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("accounts")
      .select("id, code, name")
      .in("code", ["1000", "1010"])
      .then(({ data }) => {
        setAccounts(data ?? []);
        const bank = (data ?? []).find((a) => a.code === "1010");
        if (bank) setAccountId(bank.id);
      });
  }, [supabase]);

  async function postToGL() {
    setBusy(true);
    setError(null);
    setMsg(null);
    const { error } = await supabase.rpc("post_invoice_revenue", { p_invoice: invoiceId });
    setBusy(false);
    if (error) return setError(error.message);
    setMsg("Revenue posted to the general ledger.");
    router.refresh();
  }

  async function recordReceipt(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const { error } = await supabase.rpc("record_receipt", {
      p_company: COMPANY_ID,
      p_invoice: invoiceId,
      p_amount: Number(amount),
      p_account: accountId || null,
      p_date: date,
      p_memo: memo || null,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setMsg("Receipt recorded and posted.");
    router.refresh();
  }

  return (
    <div className="card space-y-4">
      <h2 className="font-semibold">Accounting actions</h2>
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-outline" onClick={postToGL} disabled={busy}>
          Post revenue to GL
        </button>
        <span className="text-sm text-slate-500">
          Outstanding balance: <b>{money(balance, currency)}</b>
        </span>
      </div>

      {balance > 0 && (
        <form onSubmit={recordReceipt} className="grid grid-cols-12 items-end gap-2 border-t border-slate-100 pt-4">
          <div className="col-span-3">
            <label className="label">Amount ({currency})</label>
            <input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} required />
          </div>
          <div className="col-span-3">
            <label className="label">Deposit to</label>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </div>
          <div className="col-span-3">
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="col-span-3">
            <button className="btn w-full" disabled={busy}>{busy ? "Recording…" : "Record receipt"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
