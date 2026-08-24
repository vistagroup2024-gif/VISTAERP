"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Line = { account: string; debit: number; credit: number; description: string | null };
type PV = {
  id: string; doc_type: string; date: string; narration: string | null; reference: string | null;
  amount: number; status: string; approvals_needed: number; approvals: number;
  maker: string; created_at: string; reject_reason: string | null; lines: Line[];
};

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const DOC_LABEL: Record<string, string> = { gl_receipt: "Receipt", gl_payment: "Payment", gl_contra: "Contra", gl_journal: "Journal" };

export default function ApprovalList({ items, canAuthorize }: { items: PV[]; canAuthorize: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(fn: string, id: string, extra?: any) {
    setBusy(id); setErr(null);
    const { error } = await supabase.rpc(fn, { p_pending: id, ...extra });
    setBusy(null);
    if (error) return setErr(error.message);
    router.refresh();
  }

  if (items.length === 0) return <div className="card text-slate-400">Nothing here.</div>;

  return (
    <div className="space-y-3">
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
      {items.map((v) => (
        <div key={v.id} className="card p-0">
          <div className="flex flex-wrap items-center gap-3 p-3">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{DOC_LABEL[v.doc_type] ?? v.doc_type}</span>
            <span className="text-sm text-slate-500">{v.date}</span>
            <span className="font-medium">{v.narration || <span className="text-slate-400">No narration</span>}</span>
            <span className="ml-auto text-lg font-bold tabular-nums">{money(Number(v.amount))}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
            <span>By <b className="text-slate-700">{v.maker}</b></span>
            <span>Approvals {v.approvals}/{v.approvals_needed}</span>
            {v.status !== "pending" && <span className={`rounded-full px-2 py-0.5 font-medium ${v.status === "authorized" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{v.status}</span>}
            {v.reject_reason && <span className="text-red-600">Reason: {v.reject_reason}</span>}
            <button onClick={() => setOpen(open === v.id ? null : v.id)} className="ml-auto text-brand hover:underline">{open === v.id ? "Hide lines" : "View lines"}</button>
          </div>
          {open === v.id && (
            <table className="w-full border-t border-slate-100 text-sm">
              <tbody>
                {v.lines.map((l, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="px-3 py-1.5">{l.account}</td>
                    <td className="px-3 py-1.5 text-slate-500">{l.description}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.debit) ? money(Number(l.debit)) : ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.credit) ? money(Number(l.credit)) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {v.status === "pending" && (
            <div className="flex items-center gap-2 border-t border-slate-100 p-3">
              {canAuthorize && (
                <>
                  <button disabled={busy === v.id} onClick={() => act("voucher_approve", v.id)} className="btn text-sm">Approve & Post</button>
                  <button disabled={busy === v.id} onClick={() => {
                    const reason = prompt("Reason for rejection?");
                    if (reason) act("voucher_reject", v.id, { p_reason: reason });
                  }} className="btn-outline text-sm text-red-600">Reject</button>
                </>
              )}
              <button disabled={busy === v.id} onClick={() => { if (confirm("Withdraw this voucher?")) act("voucher_cancel", v.id); }}
                className="ml-auto text-xs text-slate-400 hover:text-slate-600">Withdraw (maker)</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
