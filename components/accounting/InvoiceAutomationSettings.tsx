"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateTimeStr } from "@/lib/format";

/**
 * Invoice Automation — the rules the ERP posts by, shown and edited here.
 *
 * These used to live only inside plpgsql: whether creating an Umrah Group
 * raised a visa invoice, and what it credited, could only be answered by
 * reading a function. Each row here IS the rule the trigger reads, so what the
 * screen says is what the database will do.
 *
 * Off is the safe state and the default. A rule with no accounts cannot be
 * switched on — the RPC refuses it rather than letting it post to nothing.
 */

type Rule = {
  id: string; module: string; rule_key: string; label: string; trigger_label: string;
  enabled: boolean; cost_center: string | null; notes: string | null;
  updated_at: string | null; updated_by_name: string | null;
  debit_account_id: string | null; debit_account: string | null;
  credit_account_id: string | null; credit_account: string | null;
};
type Account = { id: string; code: string; name: string };

const MODULES: { key: string; label: string; blurb: string }[] = [
  { key: "transport", label: "Transport", blurb: "Trips posted to the ledger as they complete" },
  { key: "visa",      label: "Visa",      blurb: "Visa invoices raised from Umrah Groups" },
  { key: "hotel",     label: "Hotel",     blurb: "Hotel sales and supplier cost on vendor confirmation" },
  { key: "car",       label: "Car Sales", blurb: "Vehicle purchase, sale, receipts and monthly charges" },
];

export default function InvoiceAutomationSettings({ canEdit }: { canEdit: boolean }) {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Rule | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const [{ data: r, error: re }, { data: a, error: ae }] = await Promise.all([
      supabase.rpc("acct_automation_list"),
      supabase.from("accounts").select("id, code, name")
        .eq("is_group", false).order("code"),
    ]);
    if (re) return setErr(re.message);
    if (ae) return setErr(ae.message);
    setRules((r as Rule[]) ?? []);
    setAccounts((a as Account[]) ?? []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function save(rule: Rule, patch: Partial<Rule> & { enabled: boolean }) {
    setBusy(rule.id); setErr(null); setMsg(null);
    const { error } = await supabase.rpc("acct_automation_save", {
      p_id: rule.id,
      p_enabled: patch.enabled,
      p_debit: patch.debit_account_id ?? null,
      p_credit: patch.credit_account_id ?? null,
      p_cost_center: patch.cost_center ?? null,
    });
    setBusy(null);
    if (error) return setErr(error.message);
    setMsg(`${rule.label} saved.`);
    await load();
  }

  // Turning a rule ON starts postings happening on their own, so it is
  // confirmed rather than toggled past.
  function toggle(rule: Rule) {
    if (!rule.enabled) { setConfirming(rule); return; }
    save(rule, { enabled: false });
  }

  const byModule = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of rules) { const k = r.module; m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  }, [rules]);

  const onCount = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-4">
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card">
        <p className="text-sm text-slate-600">
          These are the rules the ERP posts by. When a rule is <b>ON</b>, the ERP creates the accounting
          entry by itself as soon as the trigger happens. When it is <b>OFF</b>, nothing is posted
          automatically — you can still post by hand from the invoice screens.
        </p>
        <p className="mt-2 text-sm">
          {onCount === 0
            ? <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">All automatic invoicing is OFF</span>
            : <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">{onCount} rule{onCount === 1 ? "" : "s"} currently ON</span>}
        </p>
      </div>

      {MODULES.map((m) => {
        const list = byModule.get(m.key) ?? [];
        if (!list.length) return null;
        return (
          <div key={m.key} className="card p-0">
            <div className="flex flex-wrap items-baseline gap-x-3 border-b border-slate-200 px-4 py-3">
              <h3 className="font-semibold text-slate-800">{m.label}</h3>
              <span className="text-xs text-slate-400">{m.blurb}</span>
            </div>

            <ul className="divide-y divide-slate-100">
              {list.map((r) => (
                <li key={r.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-800">{r.label}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                          {r.enabled ? "ON" : "OFF"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        <b>Trigger:</b> {r.trigger_label}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        <b>Debit:</b> {r.debit_account ?? <em className="text-slate-400">the party&rsquo;s own account</em>}
                        {"   ·   "}
                        <b>Credit:</b> {r.credit_account ?? <em className="text-slate-400">the party&rsquo;s own account</em>}
                        {r.cost_center && <>{"   ·   "}<b>Cost centre:</b> {r.cost_center}</>}
                      </div>
                      {r.notes && <div className="mt-1 text-xs text-slate-400">{r.notes}</div>}
                      {r.updated_at && (
                        <div className="mt-1 text-xs text-slate-400">
                          Last changed {dateTimeStr(r.updated_at)}{r.updated_by_name ? ` by ${r.updated_by_name}` : ""}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={() => toggle(r)}
                      disabled={!canEdit || busy === r.id}
                      title={canEdit ? undefined : "You do not have permission to change this"}
                      className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                        r.enabled ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
                                  : "bg-brand text-white hover:bg-brand-600"}`}>
                      {busy === r.id ? "Saving…" : r.enabled ? "Turn OFF" : "Turn ON"}
                    </button>
                  </div>

                  {canEdit && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="text-xs text-slate-500">
                        Debit account
                        <select
                          className="input mt-1 w-full text-sm"
                          value={r.debit_account_id ?? ""}
                          onChange={(e) => save(r, { enabled: r.enabled, debit_account_id: e.target.value || null })}>
                          <option value="">— the party&rsquo;s own account —</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-slate-500">
                        Credit account
                        <select
                          className="input mt-1 w-full text-sm"
                          value={r.credit_account_id ?? ""}
                          onChange={(e) => save(r, { enabled: r.enabled, credit_account_id: e.target.value || null })}>
                          <option value="">— the party&rsquo;s own account —</option>
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-pop">
            <h2 className="text-base font-semibold text-slate-800">Turn on automatic posting?</h2>
            <p className="mt-2 text-sm text-slate-600">
              <b>{confirming.label}</b> will post to the ledger by itself, every time:
            </p>
            <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {confirming.trigger_label}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Debit {confirming.debit_account ?? "the party’s own account"} · Credit{" "}
              {confirming.credit_account ?? "the party’s own account"}
            </p>
            <p className="mt-3 text-xs text-amber-700">
              Entries it creates are real postings in the general ledger. Make sure the accounts above are right first.
            </p>
            <div className="mt-5 flex gap-2">
              <button className="btn flex-1 text-sm"
                onClick={() => { const r = confirming; setConfirming(null); save(r, { enabled: true }); }}>
                Yes, turn it on
              </button>
              <button className="btn-outline text-sm" onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
