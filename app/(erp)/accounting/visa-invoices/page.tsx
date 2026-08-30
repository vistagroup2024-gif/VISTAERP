import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { guardStaffPage } from "@/lib/staffSession";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

export default async function VisaInvoicesPage() {
  await guardStaffPage("accounting.view");
  const sb = createClient();
  const { data: inv } = await sb.from("visa_invoices")
    .select("id, doc_no, doc_date, agent_id, item_name, pax, gross_sell, discount, sell_amount, cost_amount, status")
    .order("doc_no", { ascending: false }).limit(500);
  const rows = (inv as any[]) ?? [];
  const agentIds = Array.from(new Set(rows.map((r) => r.agent_id).filter(Boolean)));
  const { data: parties } = agentIds.length
    ? await sb.from("parties").select("id, name").in("id", agentIds) : { data: [] as any[] };
  const pName = new Map((parties as any[] ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="max-w-6xl">
      <PageHeader title="Visa Invoices" />
      <p className="mb-3 text-sm text-slate-500">Auto-generated when a visa group is created. Open one to edit the discount / rate, print, or delete.</p>
      <div className="card overflow-x-auto p-0 text-sm">
        <table className="w-full">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Doc No.</th><th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Customer</th><th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Pax</th><th className="px-3 py-2 text-right">Gross</th>
              <th className="px-3 py-2 text-right">Disc.</th><th className="px-3 py-2 text-right">Net</th>
              <th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2"><Link href={`/accounting/visa-invoices/${r.id}`} className="font-mono text-brand hover:underline">{r.doc_no}</Link></td>
                <td className="px-3 py-2 text-slate-500">{dateStr(r.doc_date)}</td>
                <td className="px-3 py-2">{pName.get(r.agent_id) ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{r.item_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.pax}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(r.gross_sell)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{Number(r.discount) ? money(r.discount) : ""}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{money(r.sell_amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.cost_amount)}</td>
                <td className="px-3 py-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] uppercase text-slate-500">{r.status}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">No visa invoices yet — create a visa group.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
