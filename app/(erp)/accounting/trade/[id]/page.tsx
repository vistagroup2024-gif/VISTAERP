import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/PrintButton";
import { dateStr } from "@/lib/format";
import { TRADE_DOCS, isCarCostCenter, type LineExtra } from "@/lib/tradeDocs";

export const dynamic = "force-dynamic";

const money = (n: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const num = (v: any) => Number(v) || 0;

export default async function TradeDocPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: doc } = await sb.rpc("trade_doc_get", { p_id: params.id });
  if (!doc) return <div className="card text-slate-500">Document not found. <Link href="/accounting" className="text-brand hover:underline">Back</Link></div>;
  const d = doc as any;
  const lines = (d.lines ?? []) as any[];
  const cfg = TRADE_DOCS[d.doc_type];
  const title = cfg?.title ?? "Document";
  const meta = (d.meta ?? {}) as Record<string, any>;
  const isCar = isCarCostCenter(d.cost_center);

  // Mirror the editor: a delivery note is proof of what left, not what it cost.
  const showRateAmount = !cfg?.hideRateAmount;
  const lineExtras: LineExtra[] = (isCar && cfg?.carLineExtras ? cfg.carLineExtras : cfg?.lineExtras ?? [])
    .filter((x) => lines.some((l) => (l.meta ?? {})[x.key] != null && String((l.meta ?? {})[x.key]) !== ""));
  const tagInLine = !!cfg?.tagAreaInLine && lines.some((l) => (l.meta ?? {}).tag_area);
  const carFields = isCar ? (cfg?.carHeaderExtras ?? []).filter((f) => meta[f.key] != null && String(meta[f.key]) !== "") : [];

  // Resolve the chosen Purchase / Sale Account to its name for the printout.
  const acctId = meta.purchase_account || meta.sale_account || null;
  const { data: acct } = acctId
    ? await sb.from("accounts").select("code, name").eq("id", acctId).maybeSingle()
    : { data: null as any };

  const costCols = lineExtras.filter((x) => x.cost);
  const landed = lines.reduce((s, l) => s + num(l.amount) + costCols.reduce((c, x) => c + num((l.meta ?? {})[x.key]), 0), 0);
  const span = 3 + (tagInLine ? 1 : 0) + (showRateAmount ? 1 : 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-3 flex items-center gap-2">
        <Link href="/accounting" className="btn-outline text-sm">← Accounting</Link>
        <span className="ml-auto"><PrintButton /></span>
      </div>
      <div className="print-doc rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-start justify-between border-b-2 border-brand pb-4">
          <div>
            <div className="text-xl font-bold text-slate-900">Vista Group</div>
            <div className="text-sm text-slate-500">{title}</div>
          </div>
          <div className="text-right text-sm">
            <div className="text-lg font-bold text-brand">{d.doc_no}</div>
            <div className="text-slate-500">{dateStr(d.doc_date)}</div>
            <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase text-slate-600">{d.status}</div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {d.party_name && <div><span className="text-slate-400">Party: </span>{d.party_name}</div>}
          {d.reference && <div><span className="text-slate-400">Reference: </span>{d.reference}</div>}
          {d.cost_center && <div><span className="text-slate-400">Cost Center: </span>{d.cost_center}</div>}
          {d.tag_area && <div><span className="text-slate-400">Tag Area: </span>{d.tag_area}</div>}
          {acct && <div><span className="text-slate-400">{meta.sale_account ? "Sale" : "Purchase"} Account: </span>{acct.code} · {acct.name}</div>}
          {d.mode_of_payment && <div><span className="text-slate-400">Mode: </span>{d.mode_of_payment}</div>}
          {d.due_date && <div><span className="text-slate-400">Due: </span>{dateStr(d.due_date)}</div>}
          {d.delivery_date && <div><span className="text-slate-400">Delivery: </span>{dateStr(d.delivery_date)}</div>}
          {meta.update_stock === true && <div><span className="text-slate-400">Stocks: </span>updated</div>}
          {meta.raise_receipt === true && <div><span className="text-slate-400">Receipt: </span>to be raised</div>}
        </div>

        {carFields.length > 0 && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Car Sales Details</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              {carFields.map((f) => (
                <div key={f.key}>
                  <span className="text-slate-400">{f.label}: </span>
                  {f.kind === "money" ? money(num(meta[f.key]))
                    : f.kind === "percent" ? `${meta[f.key]}%`
                    : f.kind === "date" ? dateStr(meta[f.key])
                    : String(meta[f.key])}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
        <table className="mt-5 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-2">#</th>
              {tagInLine && <th className="py-2">Tag Area</th>}
              <th className="py-2">Item</th><th className="py-2">Units</th>
              <th className="py-2 text-right">Qty</th>
              {showRateAmount && <th className="py-2 text-right">Rate</th>}
              {showRateAmount && <th className="py-2 text-right">Amount</th>}
              {lineExtras.map((x) => <th key={x.key} className={`py-2 ${x.kind === "text" ? "" : "text-right"}`}>{x.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="py-2 text-slate-400">{i + 1}</td>
                {tagInLine && <td className="py-2 text-slate-500">{(l.meta ?? {}).tag_area ?? ""}</td>}
                <td className="py-2">{l.item_name}</td>
                <td className="py-2 text-slate-500">{l.units}</td>
                <td className="py-2 text-right tabular-nums">{num(l.quantity) ? num(l.quantity) : ""}</td>
                {showRateAmount && <td className="py-2 text-right tabular-nums">{num(l.rate) ? money(num(l.rate)) : ""}</td>}
                {showRateAmount && <td className="py-2 text-right tabular-nums">{money(num(l.amount))}</td>}
                {lineExtras.map((x) => (
                  <td key={x.key} className={`py-2 ${x.kind === "text" ? "text-slate-500" : "text-right tabular-nums"}`}>
                    {(l.meta ?? {})[x.key] == null || (l.meta ?? {})[x.key] === "" ? ""
                      : x.kind === "text" ? String((l.meta ?? {})[x.key]) : money(num((l.meta ?? {})[x.key]))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {showRateAmount && (
            <tfoot>
              <tr className="border-t border-slate-200"><td colSpan={span} className="py-2 text-right text-slate-500">Subtotal</td><td className="py-2 text-right tabular-nums">{money(num(d.subtotal))}</td>{lineExtras.map((x) => <td key={x.key} />)}</tr>
              {num(d.round_off) !== 0 && <tr><td colSpan={span} className="py-1 text-right text-slate-500">Round Off</td><td className="py-1 text-right tabular-nums">{money(num(d.round_off))}</td>{lineExtras.map((x) => <td key={x.key} />)}</tr>}
              <tr className="border-t-2 border-slate-200 font-bold"><td colSpan={span} className="py-2 text-right">Net Total</td><td className="py-2 text-right tabular-nums text-brand">{money(num(d.total))}</td>{lineExtras.map((x) => <td key={x.key} />)}</tr>
              {costCols.length > 0 && landed !== num(d.subtotal) && (
                <tr className="text-slate-500"><td colSpan={span} className="py-1 text-right">Landed cost (incl. expenses)</td><td className="py-1 text-right tabular-nums">{money(landed)}</td>{lineExtras.map((x) => <td key={x.key} />)}</tr>
              )}
            </tfoot>
          )}
        </table>
        </div>

        {d.terms && <div className="mt-4 text-xs text-slate-500"><span className="font-semibold">Terms: </span>{d.terms}</div>}
        {d.narration && <div className="mt-1 text-xs text-slate-500"><span className="font-semibold">Narration: </span>{d.narration}</div>}
      </div>
    </div>
  );
}
