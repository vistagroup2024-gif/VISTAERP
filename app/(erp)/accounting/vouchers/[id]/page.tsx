import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default async function VoucherPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: je } = await sb.from("journal_entries")
    .select("id, entry_no, entry_date, memo, source, reference, status").eq("id", params.id).maybeSingle();
  if (!je) return <div className="card text-slate-500">Voucher not found. <Link href="/accounting/journal" className="text-brand hover:underline">Back</Link></div>;
  const { data: lines } = await sb.from("journal_lines")
    .select("account_id, description, debit, credit, accounts(code, name)").eq("entry_id", params.id).order("created_at");

  const rows = (lines ?? []) as any[];
  const totD = rows.reduce((s, l) => s + Number(l.debit), 0);
  const totC = rows.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center gap-2">
        <Link href="/accounting/journal" className="btn-outline text-sm">← Voucher Register</Link>
        <span className="ml-auto"><PrintButton /></span>
      </div>
      <div className="print-doc rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between border-b-2 border-brand pb-4">
          <div>
            <div className="text-xl font-bold text-slate-900">Vista Group</div>
            <div className="text-sm text-slate-500">Accounting Voucher</div>
          </div>
          <div className="text-right text-sm">
            <div className="text-lg font-bold text-brand">{je.entry_no}</div>
            <div className="text-slate-500">{je.entry_date}</div>
            <div className="mt-1 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 uppercase">{je.status}</div>
          </div>
        </div>
        {je.memo && <div className="mt-4 text-sm"><span className="text-slate-400">Narration: </span>{je.memo}</div>}
        {je.reference && <div className="text-sm"><span className="text-slate-400">Reference: </span>{je.reference}</div>}

        <div className="overflow-x-auto">
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-2">Account</th><th className="py-2">Remarks</th>
              <th className="py-2 text-right">Debit</th><th className="py-2 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2"><span className="font-mono text-xs text-slate-400">{l.accounts?.code}</span> {l.accounts?.name}</td>
                <td className="py-2 text-slate-500">{l.description}</td>
                <td className="py-2 text-right tabular-nums">{Number(l.debit) ? money(Number(l.debit)) : ""}</td>
                <td className="py-2 text-right tabular-nums">{Number(l.credit) ? money(Number(l.credit)) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold">
              <td className="py-2" colSpan={2}>Total</td>
              <td className="py-2 text-right tabular-nums">{money(totD)}</td>
              <td className="py-2 text-right tabular-nums">{money(totC)}</td>
            </tr>
          </tfoot>
        </table>
        </div>
      </div>
    </div>
  );
}
