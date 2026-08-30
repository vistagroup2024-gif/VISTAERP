import { createClient } from "@/lib/supabase/server";
import { COMPANY_ID } from "@/lib/format";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";
const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n));

export default async function VatPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const sb = createClient();
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  const { data } = await sb.rpc("vat_report", { p_company: COMPANY_ID, p_from: from || null, p_to: to || null });
  const v = (data ?? {}) as any;
  const row = (label: string, val: number, strong = false) => (
    <tr className={`border-b border-slate-100 ${strong ? "font-bold" : ""}`}>
      <td className="px-4 py-2">{label}</td><td className="px-4 py-2 text-right tabular-nums">{money(val)}</td>
    </tr>
  );

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="VAT Return (15%)" />
      <form className="card flex flex-wrap items-end gap-3" method="get">
        <div><label className="label">From</label><input type="date" name="from" defaultValue={from} className="input" /></div>
        <div><label className="label">To</label><input type="date" name="to" defaultValue={to} className="input" /></div>
        <button className="btn">Run</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <tbody>
            {row("Standard-rated sales (base)", v.taxable_sales ?? 0)}
            {row("Output VAT (on sales)", v.output_vat ?? 0)}
            {row("Standard-rated purchases (base)", v.taxable_purchases ?? 0)}
            {row("Input VAT (recoverable)", v.input_vat ?? 0)}
            {row("Net VAT payable", v.net_vat ?? 0, true)}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">Figures come straight from the GL tax accounts (2-02 output, 2-03 input), so they reconcile to the ledger. ZATCA e-invoice submission is a Phase-5 integration.</p>
    </div>
  );
}
