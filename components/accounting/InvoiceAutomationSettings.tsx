"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateTimeStr } from "@/lib/format";

/**
 * Automation Rules — what the ERP does by itself, and when.
 *
 * The WHEN used to be hard-coded: whether a transport invoice was raised on
 * 'completed' rather than 'picked_up' lived in a plpgsql trigger, and this
 * screen printed a sentence describing it that no amount of clicking could
 * change. Now the trigger is a row like everything else, so changing it here
 * genuinely changes when the ERP fires.
 *
 * The dropdowns are not open lists. Events and actions come from two registries
 * seeded from what the ERP can actually detect and actually perform, and the
 * action list narrows to what can consume the chosen event — because a builder
 * that lets you save a combination the database cannot honour is worse than no
 * builder at all.
 *
 * Two kinds of row appear here and they are not the same thing. A `trigger` rule
 * fires. An `accounts` rule does not: it supplies the accounts for the second leg
 * of a posting its sibling already makes (the vendor cost inside a transport
 * invoice, the supplier cost inside a hotel one). Those legs are written in the
 * same entry by the same routine, so there is no moment at which one could fire
 * alone, and giving it an on/off switch would be a lie.
 */

type Rule = {
  id: string; module: string; rule_key: string; name: string; label: string;
  kind: "trigger" | "accounts"; system_rule: boolean; enabled: boolean;
  event_key: string | null; event_value: string | null; event_label: string | null; event_table: string | null;
  action_key: string | null; action_label: string | null;
  trigger_label: string | null; cost_center: string | null; notes: string | null;
  updated_at: string | null; updated_by_name: string | null;
  created_at: string | null; created_by_name: string | null;
  debit_account_id: string | null; debit_account: string | null;
  credit_account_id: string | null; credit_account: string | null;
};
type EventDef = {
  event_key: string; module: string; label: string; table_name: string;
  column_name: string | null; value_options: string[]; allow_free_text: boolean; description: string | null;
};
type ActionDef = {
  action_key: string; label: string; accepts_events: string[];
  needs_credit: boolean; needs_debit: boolean; description: string | null;
};
type Account = { id: string; code: string; name: string };

const MODULE_LABEL: Record<string, string> = {
  transport: "Transport", visa: "Visa", hotel: "Hotel", car: "Car Sales",
};
const pretty = (v: string | null) =>
  !v ? "" : v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function InvoiceAutomationSettings({ canEdit }: { canEdit: boolean }) {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<EventDef[]>([]);
  const [actions, setActions] = useState<ActionDef[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const [{ data: r, error: re }, { data: c, error: ce }, { data: a, error: ae }] = await Promise.all([
      supabase.rpc("acct_automation_list"),
      supabase.rpc("acct_automation_catalog"),
      supabase.from("accounts").select("id, code, name").eq("is_group", false).order("code"),
    ]);
    if (re) return setErr(re.message);
    if (ce) return setErr(ce.message);
    if (ae) return setErr(ae.message);
    setRules((r as Rule[]) ?? []);
    setEvents(((c as any)?.events ?? []) as EventDef[]);
    setActions(((c as any)?.actions ?? []) as ActionDef[]);
    setAccounts((a as Account[]) ?? []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function save(rule: Rule, patch: Record<string, any>) {
    setBusy(rule.id); setErr(null); setMsg(null);
    const { error } = await supabase.rpc("acct_automation_save", {
      p_id: rule.id,
      p_enabled: patch.enabled ?? rule.enabled,
      p_debit: patch.debit_account_id ?? null,
      p_credit: patch.credit_account_id ?? null,
      p_cost_center: patch.cost_center ?? null,
      p_event_key: patch.event_key ?? null,
      p_event_value: patch.event_value ?? null,
      p_action_key: patch.action_key ?? null,
      p_name: patch.name ?? null,
    });
    setBusy(null);
    if (error) return setErr(error.message);
    setMsg(`${rule.name} saved.`);
    await load();
  }

  async function remove(rule: Rule) {
    if (!window.confirm(`Delete “${rule.name}”? It will stop running.`)) return;
    setBusy(rule.id); setErr(null);
    const { error } = await supabase.rpc("acct_automation_delete", { p_id: rule.id });
    setBusy(null);
    if (error) return setErr(error.message);
    setMsg(`${rule.name} deleted.`);
    await load();
  }

  const triggers = useMemo(() => rules.filter((r) => r.kind === "trigger"), [rules]);
  const accountRules = useMemo(() => rules.filter((r) => r.kind === "accounts"), [rules]);
  const onCount = triggers.filter((r) => r.enabled).length;
  const eventFor = (k: string | null) => events.find((e) => e.event_key === k) ?? null;

  function whenText(r: Rule) {
    if (r.module === "car") return r.trigger_label ?? "—";
    const e = eventFor(r.event_key);
    if (!e) return r.trigger_label ?? "—";
    return e.column_name ? `${e.label} ${pretty(r.event_value)}` : e.label;
  }

  return (
    <div className="space-y-4">
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
      {err && <div className="rounded border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-fg">{err}</div>}

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-600">
            When something happens in the ERP, these rules decide what is created automatically.
            A rule that is <b>OFF</b> does nothing; you can still post by hand from the invoice screens.
          </p>
          <p className="mt-2 text-sm">
            {onCount === 0
              ? <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">All automation is OFF</span>
              : <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800">{onCount} rule{onCount === 1 ? "" : "s"} ON</span>}
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setCreating(true)} className="btn shrink-0 text-sm">+ New Automation</button>
        )}
      </div>

      {/* ── the one table that answers "what does this ERP do by itself?" ── */}
      <div className="card p-0">
        <div className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-700">Automation Rules</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="th">Automation</th><th className="th">Module</th>
                <th className="th">When</th><th className="th">Automatically does</th>
                <th className="th text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="td font-medium text-slate-800">
                    {r.name}
                    {!r.system_rule && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">yours</span>}
                  </td>
                  <td className="td">{MODULE_LABEL[r.module] ?? r.module}</td>
                  <td className="td text-slate-600">{whenText(r)}</td>
                  <td className="td text-slate-600">{r.action_label ?? "Module posting"}</td>
                  <td className="td text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      r.enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                      {r.enabled ? "ON" : "OFF"}
                    </span>
                  </td>
                </tr>
              ))}
              {triggers.length === 0 && (
                <tr><td className="td text-center text-slate-400" colSpan={5}>No automation rules.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── the detail of whichever rule is open ── */}
      {triggers.filter((r) => r.id === open).map((r) => {
        const e = eventFor(r.event_key);
        const usable = actions.filter((a) => !r.event_key || a.accepts_events.includes(r.event_key));
        const isCar = r.module === "car";
        return (
          <div key={r.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-800">{r.name}</h3>
              <div className="flex items-center gap-2">
                {canEdit && !r.system_rule && (
                  <button onClick={() => remove(r)} disabled={busy === r.id}
                    className="rounded-md px-2 py-1 text-xs text-red-500 hover:underline">Delete</button>
                )}
                <button
                  onClick={() => (r.enabled ? save(r, { enabled: false }) : setConfirming(r))}
                  disabled={!canEdit || busy === r.id}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    r.enabled ? "border border-slate-200 text-slate-600 hover:bg-slate-50"
                              : "bg-brand text-white hover:bg-brand-600"}`}>
                  {busy === r.id ? "Saving…" : r.enabled ? "Turn OFF" : "Turn ON"}
                </button>
              </div>
            </div>

            {isCar ? (
              <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <b>When:</b> {r.trigger_label}. This is a Car Sales posting — its trigger and its accounts are
                resolved inside the Car module and are not configurable here yet. It can be switched on and off.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-500">
                  When — the event
                  <select className="input mt-1 w-full text-sm" disabled={!canEdit}
                    value={r.event_key ?? ""}
                    onChange={(ev) => save(r, { event_key: ev.target.value, event_value: null })}>
                    {events.filter((x) => x.module === r.module).map((x) => (
                      <option key={x.event_key} value={x.event_key}>{x.label}</option>
                    ))}
                  </select>
                </label>

                {e?.column_name && (
                  <label className="text-xs text-slate-500">
                    …becomes
                    <select className="input mt-1 w-full text-sm" disabled={!canEdit}
                      value={r.event_value ?? ""}
                      onChange={(ev) => save(r, { event_value: ev.target.value })}>
                      <option value="">— choose —</option>
                      {e.value_options.map((v) => <option key={v} value={v}>{pretty(v)}</option>)}
                      {e.allow_free_text && r.event_value && !e.value_options.includes(r.event_value) && (
                        <option value={r.event_value}>{pretty(r.event_value)} (typed)</option>
                      )}
                    </select>
                  </label>
                )}

                <label className="text-xs text-slate-500 sm:col-span-2">
                  Automatically does
                  <select className="input mt-1 w-full text-sm" disabled={!canEdit}
                    value={r.action_key ?? ""}
                    onChange={(ev) => save(r, { action_key: ev.target.value })}>
                    {usable.map((a) => <option key={a.action_key} value={a.action_key}>{a.label}</option>)}
                  </select>
                </label>

                <label className="text-xs text-slate-500">
                  Debit account
                  <select className="input mt-1 w-full text-sm" disabled={!canEdit}
                    value={r.debit_account_id ?? ""}
                    onChange={(ev) => save(r, { debit_account_id: ev.target.value || null })}>
                    <option value="">— the party&rsquo;s own account —</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Credit account
                  <select className="input mt-1 w-full text-sm" disabled={!canEdit}
                    value={r.credit_account_id ?? ""}
                    onChange={(ev) => save(r, { credit_account_id: ev.target.value || null })}>
                    <option value="">— the party&rsquo;s own account —</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </select>
                </label>
              </div>
            )}

            {e?.description && <p className="text-xs text-slate-400">{e.description}</p>}
            {r.notes && <p className="text-xs text-slate-400">{r.notes}</p>}
            <div className="border-t border-slate-100 pt-2 text-xs text-slate-400">
              Cost centre {r.cost_center ?? "—"}
              {r.created_by_name && <> · created by {r.created_by_name}</>}
              {r.updated_at && <> · last changed {dateTimeStr(r.updated_at)}{r.updated_by_name ? ` by ${r.updated_by_name}` : ""}</>}
            </div>
          </div>
        );
      })}

      {/* ── the account-only rows, honestly labelled ── */}
      {accountRules.length > 0 && (
        <div className="card p-0">
          <div className="border-b border-slate-200 px-4 py-2">
            <span className="font-semibold text-slate-700">Accounts used by the rules above</span>
            <p className="mt-0.5 text-xs text-slate-400">
              These are not separate automations. Each supplies the accounts for the second leg of a posting
              the matching rule already makes — both legs are written in one entry, so there is nothing to
              switch on or off on its own.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {accountRules.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="text-sm font-medium text-slate-800">{r.name}</div>
                <div className="mt-1 text-xs text-slate-500">
                  <b>Debit:</b> {r.debit_account ?? "the party’s own account"}
                  {"   ·   "}<b>Credit:</b> {r.credit_account ?? "the party’s own account"}
                </div>
                {canEdit && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select className="input text-sm" value={r.debit_account_id ?? ""}
                      onChange={(ev) => save(r, { debit_account_id: ev.target.value || null })}>
                      <option value="">— the party&rsquo;s own account —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                    <select className="input text-sm" value={r.credit_account_id ?? ""}
                      onChange={(ev) => save(r, { credit_account_id: ev.target.value || null })}>
                      <option value="">— the party&rsquo;s own account —</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirming && (
        <ConfirmOn rule={confirming} whenText={whenText(confirming)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => { const r = confirming; setConfirming(null); save(r, { enabled: true }); }} />
      )}
      {creating && (
        <NewAutomation events={events} actions={actions} accounts={accounts}
          onClose={() => setCreating(false)}
          onCreated={async (m) => { setCreating(false); setMsg(m); await load(); }}
          onError={setErr} />
      )}
    </div>
  );
}

function ConfirmOn({ rule, whenText, onCancel, onConfirm }:
  { rule: Rule; whenText: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-pop">
        <h2 className="text-base font-semibold text-slate-800">Turn on automatic posting?</h2>
        <p className="mt-2 text-sm text-slate-600"><b>{rule.name}</b> will run by itself, every time:</p>
        <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">{whenText}</p>
        <p className="mt-2 text-xs text-slate-500">
          It will {(rule.action_label ?? "post").toLowerCase()} — debit{" "}
          {rule.debit_account ?? "the party’s own account"}, credit {rule.credit_account ?? "the party’s own account"}.
        </p>
        <p className="mt-3 text-xs text-amber-700">These are real postings in the general ledger.</p>
        <div className="mt-5 flex gap-2">
          <button className="btn flex-1 text-sm" onClick={onConfirm}>Yes, turn it on</button>
          <button className="btn-outline text-sm" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Build a new rule. Every list here is the registry's, so a combination that
 *  can be selected is a combination the ERP can actually carry out. */
function NewAutomation({ events, actions, accounts, onClose, onCreated, onError }: {
  events: EventDef[]; actions: ActionDef[]; accounts: Account[];
  onClose: () => void; onCreated: (msg: string) => void; onError: (m: string) => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState("");
  const [module, setModule] = useState("transport");
  const [eventKey, setEventKey] = useState("");
  const [eventValue, setEventValue] = useState("");
  const [actionKey, setActionKey] = useState("");
  const [debit, setDebit] = useState("");
  const [credit, setCredit] = useState("");
  const [busy, setBusy] = useState(false);

  const modules = useMemo(() => Array.from(new Set(events.map((e) => e.module))), [events]);
  const moduleEvents = events.filter((e) => e.module === module);
  const ev = events.find((e) => e.event_key === eventKey) ?? null;
  const usable = actions.filter((a) => eventKey && a.accepts_events.includes(eventKey));
  const act = actions.find((a) => a.action_key === actionKey) ?? null;

  async function create() {
    setBusy(true);
    const { error } = await supabase.rpc("acct_automation_create", {
      p_name: name, p_event_key: eventKey,
      p_event_value: ev?.column_name ? eventValue : null,
      p_action_key: actionKey,
      p_debit: debit || null, p_credit: credit || null, p_cost_center: null,
    });
    setBusy(false);
    if (error) return onError(error.message);
    onCreated(`“${name}” created. It starts OFF — turn it on when you are ready.`);
  }

  const ready = name.trim() && eventKey && actionKey && (!ev?.column_name || eventValue);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-pop">
        <h2 className="text-base font-semibold text-slate-800">New Automation</h2>
        <p className="text-xs text-slate-500">
          Only events the ERP can detect and actions it can perform are listed. If what you need is not here,
          the ERP cannot do it yet and it needs a code change.
        </p>

        <label className="block text-xs text-slate-500">Name
          <input className="input mt-1 w-full text-sm" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Transport Customer Invoice" />
        </label>

        <label className="block text-xs text-slate-500">Module
          <select className="input mt-1 w-full text-sm" value={module}
            onChange={(e) => { setModule(e.target.value); setEventKey(""); setEventValue(""); setActionKey(""); }}>
            {modules.map((m) => <option key={m} value={m}>{MODULE_LABEL[m] ?? m}</option>)}
          </select>
        </label>

        <label className="block text-xs text-slate-500">When
          <select className="input mt-1 w-full text-sm" value={eventKey}
            onChange={(e) => { setEventKey(e.target.value); setEventValue(""); setActionKey(""); }}>
            <option value="">— choose an event —</option>
            {moduleEvents.map((e) => <option key={e.event_key} value={e.event_key}>{e.label}</option>)}
          </select>
        </label>

        {ev?.column_name && (
          <label className="block text-xs text-slate-500">…becomes
            <select className="input mt-1 w-full text-sm" value={eventValue}
              onChange={(e) => setEventValue(e.target.value)}>
              <option value="">— choose a value —</option>
              {ev.value_options.map((v) => <option key={v} value={v}>{pretty(v)}</option>)}
            </select>
            {ev.allow_free_text && (
              <input className="input mt-1 w-full text-sm" placeholder="…or type another status"
                onChange={(e) => setEventValue(e.target.value)} />
            )}
          </label>
        )}
        {ev?.description && <p className="text-xs text-slate-400">{ev.description}</p>}

        <label className="block text-xs text-slate-500">Automatically does
          <select className="input mt-1 w-full text-sm" value={actionKey}
            onChange={(e) => setActionKey(e.target.value)} disabled={!eventKey}>
            <option value="">{eventKey ? "— choose an action —" : "choose an event first"}</option>
            {usable.map((a) => <option key={a.action_key} value={a.action_key}>{a.label}</option>)}
          </select>
        </label>
        {eventKey && usable.length === 0 && (
          <p className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Nothing the ERP can do responds to that event yet. Making it do something requires a code change.
          </p>
        )}
        {act?.description && <p className="text-xs text-slate-400">{act.description}</p>}

        {act && (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-500">Debit account
              <select className="input mt-1 w-full text-sm" value={debit} onChange={(e) => setDebit(e.target.value)}>
                <option value="">— the party&rsquo;s own account —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Credit account
              <select className="input mt-1 w-full text-sm" value={credit} onChange={(e) => setCredit(e.target.value)}>
                <option value="">— the party&rsquo;s own account —</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button className="btn flex-1 text-sm" disabled={!ready || busy} onClick={create}>
            {busy ? "Creating…" : "Create automation"}
          </button>
          <button className="btn-outline text-sm" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
