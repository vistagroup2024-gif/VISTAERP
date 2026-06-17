import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function JournalDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: e } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!e) notFound();

  const { data: lines } = await supabase
    .from("journal_lines")
    .select("id, description, debit, credit, accounts(code, name)")
    .eq("entry_id", params.id);

  const totalDr = (lines ?? []).reduce((s, l) => s + Number(l.debit), 0);
  const totalCr = (lines ?? []).reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{e.entry_no}</h1>
        <p className="text-slate-500">{dateStr(e.entry_date)} · {e.memo}</p>
        <span className="badge mt-1 bg-green-100 capitalize text-green-700">{e.status}</span>
      </div>
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr><th className="th">Account</th><th className="th">Description</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th></tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l: any) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="td"><span className="font-mono text-slate-500">{l.accounts?.code}</span> {l.accounts?.name}</td>
                <td className="td text-slate-500">{l.description}</td>
                <td className="td text-right">{Number(l.debit) ? money(l.debit, "PKR") : ""}</td>
                <td className="td text-right">{Number(l.credit) ? money(l.credit, "PKR") : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="td" colSpan={2}>Totals</td>
              <td className="td text-right">{money(totalDr, "PKR")}</td>
              <td className="td text-right">{money(totalCr, "PKR")}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
