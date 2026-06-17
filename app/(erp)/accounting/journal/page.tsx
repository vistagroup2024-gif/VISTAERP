import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr, money } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const supabase = createClient();
  const { data: entries } = await supabase
    .from("journal_entries")
    .select("id, entry_no, entry_date, memo, status, source, journal_lines(debit)")
    .order("entry_date", { ascending: false })
    .limit(200);

  return (
    <div>
      <PageHeader title="Journal" action={{ href: "/accounting/journal/new", label: "+ Manual Entry" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Entry #</th>
              <th className="th">Date</th>
              <th className="th">Memo</th>
              <th className="th">Source</th>
              <th className="th text-right">Amount</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {(entries ?? []).map((e: any) => {
              const amount = (e.journal_lines ?? []).reduce((s: number, l: any) => s + Number(l.debit), 0);
              return (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="td font-mono">
                    <Link href={`/accounting/journal/${e.id}`} className="text-brand hover:underline">{e.entry_no}</Link>
                  </td>
                  <td className="td">{dateStr(e.entry_date)}</td>
                  <td className="td">{e.memo}</td>
                  <td className="td capitalize">{e.source ?? "—"}</td>
                  <td className="td text-right">{money(amount, "PKR")}</td>
                  <td className="td"><span className={`badge ${e.status === "posted" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{e.status}</span></td>
                </tr>
              );
            })}
            {(entries ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={6}>No journal entries yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
