"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DOC_SERIES, seriesPreview, type SeriesDef } from "@/lib/docSeries";

type Row = { doc_type: string; prefix: string; padding: number; next_number: number; last_issued: string | null };
type Draft = { prefix: string; padding: string; next: string };

export default function NumberingManager({ rows, ledgerUsesDocNo }: { rows: Row[]; ledgerUsesDocNo: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const byKey = useMemo(() => new Map(rows.map((r) => [r.doc_type, r])), [rows]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [useDocNo, setUseDocNo] = useState(ledgerUsesDocNo);

  // The catalogue in its own order, then anything the database has that the
  // catalogue does not name.
  const known = new Set(DOC_SERIES.map((d) => d.key));
  const others: SeriesDef[] = rows.filter((r) => !known.has(r.doc_type)).map((r) => ({
    key: r.doc_type, label: r.doc_type, kind: r.doc_type.startsWith("gl_") ? "ledger" : "document",
    defaultPrefix: r.prefix, defaultPadding: r.padding,
  }));

  function current(d: SeriesDef): Draft {
    const r = byKey.get(d.key);
    return drafts[d.key] ?? {
      prefix: r?.prefix ?? d.defaultPrefix,
      padding: String(r?.padding ?? d.defaultPadding),
      next: String(r?.next_number ?? 1),
    };
  }
  function edit(key: string, d: Draft) { setDrafts((a) => ({ ...a, [key]: d })); }
  function isDirty(d: SeriesDef) {
    const c = current(d); const r = byKey.get(d.key);
    return c.prefix !== (r?.prefix ?? d.defaultPrefix) || Number(c.padding) !== (r?.padding ?? d.defaultPadding) || Number(c.next) !== (r?.next_number ?? 1);
  }

  async function save(d: SeriesDef) {
    const c = current(d);
    setBusy(d.key); setErr(null); setDone(null);
    const { error } = await supabase.rpc("doc_sequence_save", {
      p_doc_type: d.key, p_prefix: c.prefix, p_padding: Number(c.padding) || 0, p_next: Number(c.next) || 1,
    });
    setBusy(null);
    if (error) return setErr(error.message);
    setDone(`${d.label}: next number will be ${seriesPreview(c.prefix, Number(c.padding) || 0, Number(c.next) || 1)}`);
    setDrafts((a) => { const n = { ...a }; delete n[d.key]; return n; });
    router.refresh();
  }
  async function saveSetting(on: boolean) {
    setBusy("setting"); setErr(null); setDone(null);
    const { error } = await supabase.rpc("doc_numbering_settings_save", { p_ledger_uses_doc_no: on });
    setBusy(null);
    if (error) return setErr(error.message);
    setUseDocNo(on);
    setDone(on ? "A trade voucher's ledger entry now carries the document's own number." : "A trade voucher's ledger entry is numbered from its own series again.");
    router.refresh();
  }

  const Section = ({ title, kind, note }: { title: string; kind: SeriesDef["kind"]; note: string }) => {
    const list = [...DOC_SERIES.filter((d) => d.kind === kind), ...others.filter((d) => d.kind === kind)];
    return (
      <div className="card p-0">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="font-semibold text-slate-700">{title}</div>
          <div className="text-xs text-slate-500">{note}</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 text-left">Voucher</th>
                <th className="px-3 py-2 text-left">Prefix</th>
                <th className="px-3 py-2 text-left">Digits</th>
                <th className="px-3 py-2 text-left">Next number</th>
                <th className="px-3 py-2 text-left">Will read</th>
                <th className="px-3 py-2 text-left">Last issued</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => {
                const c = current(d); const r = byKey.get(d.key);
                const dirty = isDirty(d);
                const tooLow = r && Number(c.next) < r.next_number;
                return (
                  <tr key={d.key} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{d.label}</div>
                      {d.note && <div className="text-xs text-slate-400">{d.note}</div>}
                      {!known.has(d.key) && <div className="font-mono text-[11px] text-slate-400">{d.key}</div>}
                    </td>
                    <td className="px-3 py-2"><input className="input w-28 font-mono" value={c.prefix} maxLength={12}
                      onChange={(e) => edit(d.key, { ...c, prefix: e.target.value })} /></td>
                    <td className="px-3 py-2"><input className="input w-20 text-right tabular-nums" inputMode="numeric" value={c.padding}
                      onChange={(e) => edit(d.key, { ...c, padding: e.target.value.replace(/\D/g, "") })} /></td>
                    <td className="px-3 py-2"><input className={`input w-28 text-right tabular-nums ${tooLow ? "border-red-400 bg-red-50" : ""}`} inputMode="numeric" value={c.next}
                      title={tooLow ? `Cannot go below ${r!.next_number} — numbers up to ${r!.last_issued} are already issued` : undefined}
                      onChange={(e) => edit(d.key, { ...c, next: e.target.value.replace(/\D/g, "") })} /></td>
                    <td className="px-3 py-2 font-mono text-slate-700">{seriesPreview(c.prefix, Number(c.padding) || 0, Number(c.next) || 1)}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">{r?.last_issued ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => save(d)} disabled={busy === d.key || !dirty || !!tooLow}
                        className="btn text-xs disabled:opacity-30">{busy === d.key ? "…" : "Save"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Each series is a prefix, how many digits the number is padded to, and the next number to issue.
        A number already issued is never re-used: the next number can be moved forward, not back.
      </p>
      {err && <div className="rounded-md border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}
      {done && <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{done}</div>}

      <div className="card">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" className="mt-1" checked={useDocNo} disabled={busy === "setting"} onChange={(e) => saveSetting(e.target.checked)} />
          <span>
            <span className="font-medium text-slate-800">A trade voucher&apos;s ledger entry carries the document&apos;s own number</span>
            <span className="mt-1 block text-xs text-slate-500">
              On: Purchase Voucher PV-00003 posts as PV-00003 on the ledger and in the Voucher Register, and the
              &ldquo;— entry&rdquo; series below are not used for them. Off: the entry is numbered from its own series
              (JPV-00004), with the document number in the entry&apos;s Reference. Receipt, Payment, Journal, Contra and
              Petty Cash are the entry itself, so they are unaffected either way.
            </span>
          </span>
        </label>
      </div>

      <Section title="Documents" kind="document" note="The number the voucher itself carries — typed to find it again, printed on it." />
      <Section title="Ledger entries" kind="ledger" note="The number the journal entry behind a posting gets — what the ledger and the Voucher Register show." />
    </div>
  );
}
