"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateTimeStr } from "@/lib/format";

type Rule = {
  rule_key: string; label: string; module: string; category: string;
  audience: "staff" | "agent"; enabled: boolean;
  thresholds: number[]; anchor_label: string; anchor_time: string | null;
  title: string; titles: Record<string, string>; body: string;
  placeholders: string[];
  updated_at: string | null; updated_by_name: string | null;
};

/** What a reminder's hours mean, said in words, because "24, 12, 4" alone does
 *  not tell you 24 hours before WHAT. */
function whenText(r: Rule) {
  const at = r.anchor_time ? ` (${r.anchor_time})` : "";
  const hrs = [...r.thresholds].sort((a, b) => b - a);
  if (hrs.length === 0) return "never — no reminder times set";
  return `${hrs.map((h) => `${h}h`).join(", then ")} before ${r.anchor_label}${at}`;
}

export default function NotificationRules({ canEdit }: { canEdit: boolean }) {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [hoursText, setHoursText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("notification_rules_list");
    if (error) return setErr(error.message);
    setRules((data as Rule[]) ?? []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  function open(r: Rule) {
    setOpenKey(r.rule_key === openKey ? null : r.rule_key);
    setDraft({ ...r, titles: { ...(r.titles ?? {}) } });
    setHoursText([...r.thresholds].sort((a, b) => b - a).join(", "));
    setMsg(null); setErr(null);
  }

  async function save() {
    if (!draft) return;
    // Parsed here only so the box can be typed in freely; the routine sorts,
    // de-duplicates and refuses the rest, so this is convenience, not validation.
    const hours = hoursText.split(/[^0-9]+/).map((s) => parseInt(s, 10)).filter((n) => n > 0);
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase.rpc("notification_rules_save", {
      p_key: draft.rule_key,
      p_enabled: draft.enabled,
      p_thresholds: hours,
      p_anchor_time: draft.anchor_time ?? "",
      p_title: draft.title,
      p_titles: draft.titles ?? {},
      p_body: draft.body,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg("Saved.");
    load();
  }

  if (err && !rules) return <p className="text-sm text-red-600">{err}</p>;
  if (!rules) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        These four reminders are raised by the hourly job. You can change <b>when</b> they go out,
        <b> what they say</b>, and whether they run at all. Each one is sent once per record per
        reminder time, so nobody is told twice.
      </p>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2 text-left">Reminder</th>
              <th className="px-3 py-2 text-left">Goes to</th>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <Fragment key={r.rule_key}>
                <tr onClick={() => open(r)}
                  className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40">
                  <td className="px-3 py-2 font-medium text-slate-800">{r.label}</td>
                  <td className="px-3 py-2 text-slate-500">{r.audience === "agent" ? "B2B agent" : "Staff"}</td>
                  <td className="px-3 py-2 text-slate-600">{whenText(r)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] uppercase ${
                      r.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {r.enabled ? "On" : "Off"}
                    </span>
                  </td>
                </tr>

                {openKey === r.rule_key && draft && (
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td colSpan={4} className="px-3 py-4">
                      <div className="space-y-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input type="checkbox" checked={draft.enabled} disabled={!canEdit}
                            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
                          <span>Send this reminder</span>
                        </label>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="label">Hours before {r.anchor_label}</label>
                            <input className="input" value={hoursText} disabled={!canEdit}
                              onChange={(e) => setHoursText(e.target.value)} placeholder="24, 12, 4" />
                            <p className="mt-1 text-xs text-slate-400">
                              One reminder per number. Whichever is closest to the deadline wins, so a
                              job that missed a run says where you actually are rather than sending all
                              of them at once.
                            </p>
                          </div>
                          <div>
                            <label className="label">
                              {r.anchor_label} happens at
                              <span className="ml-1 font-normal normal-case text-slate-400">· Saudi time</span>
                            </label>
                            <input type="time" className="input" value={draft.anchor_time ?? ""}
                              disabled={!canEdit}
                              onChange={(e) => setDraft({ ...draft, anchor_time: e.target.value || null })} />
                            <p className="mt-1 text-xs text-slate-400">
                              Leave empty to count back from the start of the day. A hotel check-in is 14:00.
                            </p>
                          </div>
                        </div>

                        <div>
                          <label className="label">Title</label>
                          <input className="input" value={draft.title} disabled={!canEdit}
                            onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                        </div>

                        {/* Per-hour titles, where the escalation says something
                            different the closer it gets. Only offered for rules
                            that already work that way. */}
                        {Object.keys(r.titles ?? {}).length > 0 && (
                          <div className="space-y-2">
                            <div className="label">Title at each reminder time</div>
                            {[...r.thresholds].sort((a, b) => b - a).map((h) => (
                              <div key={h} className="flex items-center gap-2">
                                <span className="w-12 shrink-0 text-right text-xs text-slate-500">{h}h</span>
                                <input className="input" disabled={!canEdit}
                                  value={draft.titles?.[String(h)] ?? ""}
                                  placeholder={draft.title}
                                  onChange={(e) => setDraft({
                                    ...draft,
                                    titles: { ...(draft.titles ?? {}), [String(h)]: e.target.value },
                                  })} />
                              </div>
                            ))}
                            <p className="text-xs text-slate-400">
                              Left empty, that reminder time uses the Title above.
                            </p>
                          </div>
                        )}

                        <div>
                          <label className="label">Message</label>
                          <textarea className="input min-h-[70px]" value={draft.body} disabled={!canEdit}
                            onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                          <p className="mt-1 text-xs text-slate-400">
                            You can use: {r.placeholders.map((p) => <code key={p} className="mr-1 rounded bg-slate-200 px-1">{`{${p}}`}</code>)}
                            — anything else is refused when you save, rather than appearing in braces in
                            somebody&rsquo;s notification.
                          </p>
                        </div>

                        {canEdit && (
                          <div className="flex items-center gap-3">
                            <button onClick={save} disabled={busy} className="btn disabled:opacity-40">
                              {busy ? "Saving…" : "Save"}
                            </button>
                            {r.updated_at && (
                              <span className="text-xs text-slate-400">
                                last changed {dateTimeStr(r.updated_at)}
                                {r.updated_by_name ? ` by ${r.updated_by_name}` : ""}
                              </span>
                            )}
                          </div>
                        )}
                        {!canEdit && (
                          <p className="text-xs text-amber-700">
                            You can see these but not change them — it takes an administrator, or the
                            &ldquo;Notification rules&rdquo; right.
                          </p>
                        )}
                        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
                        {err && <p className="text-sm text-red-600">{err}</p>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        The other notifications — Drivers assigned, Voucher awaiting authorisation, Cancellation
        requested and the rest — fire on an event rather than a clock, so they have no timing to set
        and are not listed here.
      </p>
    </div>
  );
}
