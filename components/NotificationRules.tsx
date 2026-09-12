"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dateTimeStr } from "@/lib/format";

type Rule = {
  rule_key: string; label: string; module: string; category: string;
  audience: "staff" | "agent"; kind: "reminder" | "event";
  enabled: boolean; system_rule: boolean; sends_ref: boolean;
  situation_key: string | null; situation_label: string | null;
  thresholds: number[]; anchor_label: string; anchor_time: string | null;
  title: string; titles: Record<string, string>; body: string;
  placeholders: string[];
  updated_at: string | null; updated_by_name: string | null;
};

type Situation = {
  situation_key: string; label: string; detail: string;
  module: string; category: string; anchor_label: string;
  default_anchor_time: string | null;
  audiences: ("staff" | "agent")[]; placeholders: string[];
};

const hoursList = (hs: number[]) => [...(hs ?? [])].sort((a, b) => b - a);

/** What a reminder's hours mean, said in words, because "24, 12, 4" alone does
 *  not tell you 24 hours before WHAT. An event rule has no hours at all, so it
 *  says what it reacts to instead. */
function whenText(r: Rule) {
  if (r.kind === "event") return `when ${r.anchor_label} happens`;
  const at = r.anchor_time ? ` (${r.anchor_time})` : "";
  const hrs = hoursList(r.thresholds);
  if (hrs.length === 0) return "never — no reminder times set";
  return `${hrs.map((h) => `${h}h`).join(", then ")} before ${r.anchor_label}${at}`;
}

const parseHours = (s: string) =>
  s.split(/[^0-9]+/).map((x) => parseInt(x, 10)).filter((n) => n > 0);

export default function NotificationRules({ canEdit }: { canEdit: boolean }) {
  const supabase = createClient();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [situations, setSituations] = useState<Situation[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rule | null>(null);
  const [hoursText, setHoursText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // the Add panel
  const [adding, setAdding] = useState(false);
  const [nSit, setNSit] = useState("");
  const [nLabel, setNLabel] = useState("");
  const [nAudience, setNAudience] = useState<"staff" | "agent">("staff");
  const [nHours, setNHours] = useState("24");
  const [nAnchorTime, setNAnchorTime] = useState("");
  const [nTitle, setNTitle] = useState("");
  const [nBody, setNBody] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data, error }, { data: sit }] = await Promise.all([
      supabase.rpc("notification_rules_list"),
      supabase.rpc("notification_situations_list"),
    ]);
    if (error) return setErr(error.message);
    setRules((data as Rule[]) ?? []);
    setSituations((sit as Situation[]) ?? []);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const situation = useMemo(
    () => situations.find((s) => s.situation_key === nSit) ?? null,
    [situations, nSit],
  );

  function pickSituation(key: string) {
    setNSit(key);
    const s = situations.find((x) => x.situation_key === key);
    if (!s) return;
    setNAnchorTime(s.default_anchor_time ?? "");
    if (!s.audiences.includes(nAudience)) setNAudience(s.audiences[0]);
    if (!nLabel) setNLabel(s.label);
  }

  function open(r: Rule) {
    setOpenKey(r.rule_key === openKey ? null : r.rule_key);
    setDraft({ ...r, titles: { ...(r.titles ?? {}) } });
    setHoursText(hoursList(r.thresholds).join(", "));
    setMsg(null); setErr(null);
  }

  async function save() {
    if (!draft) return;
    // Parsed here only so the box can be typed in freely; the routine sorts,
    // de-duplicates and refuses the rest, so this is convenience, not validation.
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase.rpc("notification_rules_save", {
      p_key: draft.rule_key,
      p_enabled: draft.enabled,
      p_thresholds: draft.kind === "reminder" ? parseHours(hoursText) : [],
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

  async function remove(r: Rule) {
    if (!window.confirm(`Delete “${r.label}”? It will stop going out.`)) return;
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase.rpc("notification_rule_delete", { p_key: r.rule_key });
    setBusy(false);
    if (error) return setErr(error.message);
    setOpenKey(null); setDraft(null);
    load();
  }

  async function add() {
    setBusy(true); setAddErr(null);
    const { error } = await supabase.rpc("notification_rule_create", {
      p_situation: nSit,
      p_label: nLabel,
      p_audience: nAudience,
      p_thresholds: parseHours(nHours),
      p_anchor_time: nAnchorTime,
      p_title: nTitle,
      p_body: nBody,
    });
    setBusy(false);
    if (error) return setAddErr(error.message);
    setAdding(false);
    setNSit(""); setNLabel(""); setNHours("24"); setNAnchorTime("");
    setNTitle(""); setNBody(""); setNAudience("staff");
    setMsg("Reminder added. It runs on the next hourly job.");
    load();
  }

  if (err && !rules) return <p className="text-sm text-red-600">{err}</p>;
  if (!rules) return <p className="text-sm text-slate-400">Loading…</p>;

  const reminders = rules.filter((r) => r.kind === "reminder");
  const events = rules.filter((r) => r.kind === "event");

  const tokenHelp = (list: string[]) =>
    list.map((p) => (
      <code key={p} className="mr-1 rounded bg-slate-200 px-1">{`{${p}}`}</code>
    ));

  const editor = (r: Rule) => draft && (
    <tr className="border-t border-slate-100 bg-slate-50/60">
      <td colSpan={5} className="px-3 py-4">
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.enabled} disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            <span>{draft.kind === "event" ? "Send this notification" : "Send this reminder"}</span>
          </label>

          {draft.kind === "event" ? (
            <p className="rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              This one fires the moment {r.anchor_label} — there is no clock to set. Switch it off
              and nothing is written at all: no bell entry and no phone notification.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Hours before {r.anchor_label}</label>
                <input className="input" value={hoursText} disabled={!canEdit}
                  onChange={(e) => setHoursText(e.target.value)} placeholder="24, 12, 4" />
                <p className="mt-1 text-xs text-slate-400">
                  One reminder per number. Whichever is closest to the deadline wins, so a job that
                  missed a run says where you actually are rather than sending all of them at once.
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
          )}

          {draft.situation_label && (
            <p className="text-xs text-slate-400">
              Watches: <b>{draft.situation_label}</b>
            </p>
          )}

          <div>
            <label className="label">Title</label>
            <input className="input" value={draft.title} disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            {draft.kind === "event" && draft.sends_ref && (
              <p className="mt-1 text-xs text-slate-400">
                Keep <code className="rounded bg-slate-200 px-1">{"{ref}"}</code> — it is the booking
                or group this notification is about, and without it every one of them reads the same.
              </p>
            )}
          </div>

          {/* Per-hour titles, where the escalation says something different the
              closer it gets. Only offered for rules that already work that way. */}
          {draft.kind === "reminder" && Object.keys(r.titles ?? {}).length > 0 && (
            <div className="space-y-2">
              <div className="label">Title at each reminder time</div>
              {parseHours(hoursText).sort((a, b) => b - a).map((h) => (
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
              You can use: {tokenHelp(r.placeholders)}
              — anything else is refused when you save, rather than appearing in braces in
              somebody&rsquo;s notification.
            </p>
            {draft.kind === "event" && (
              <p className="mt-1 text-xs text-slate-400">
                <code className="rounded bg-slate-200 px-1">{"{default}"}</code> is the sentence the
                ERP built — the booking number, the guest, the amount. You can replace it or wrap it
                (<i>ACTION: {"{default}"}</i>), but it cannot be taken apart: only the finished
                sentence reaches this point.
              </p>
            )}
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={save} disabled={busy} className="btn disabled:opacity-40">
                {busy ? "Saving…" : "Save"}
              </button>
              {!r.system_rule && (
                <button onClick={() => remove(r)} disabled={busy}
                  className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40">
                  Delete
                </button>
              )}
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
  );

  const table = (rows: Rule[], firstCol: string, whenCol: string) => (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left">{firstCol}</th>
            <th className="px-3 py-2 text-left">Goes to</th>
            <th className="px-3 py-2 text-left">{whenCol}</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
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
                <td className="px-3 py-2 text-right text-[11px] uppercase text-slate-400">
                  {r.system_rule ? "" : "Added"}
                </td>
              </tr>
              {openKey === r.rule_key && editor(r)}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── scheduled reminders ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Reminders — sent on a clock</h2>
            <p className="text-sm text-slate-500">
              The hourly job counts back to a date and sends these before it. You can change
              <b> when</b> they go out, <b>what they say</b>, and whether they run at all. Each one is
              sent once per record per reminder time, so nobody is told twice.
            </p>
          </div>
          {canEdit && !adding && (
            <button onClick={() => setAdding(true)} className="btn shrink-0">+ Add a reminder</button>
          )}
        </div>

        {adding && (
          <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-4">
            <p className="text-sm text-slate-600">
              A reminder needs something to count down to, and the ERP can only count down to what it
              actually looks at. Pick the situation; the hours and the wording are yours.
            </p>

            <div>
              <label className="label">What is it about?</label>
              <select className="input" value={nSit} onChange={(e) => pickSituation(e.target.value)}>
                <option value="">Choose a situation…</option>
                {situations.map((s) => (
                  <option key={s.situation_key} value={s.situation_key}>{s.label}</option>
                ))}
              </select>
              {situation && (
                <p className="mt-1 text-xs text-slate-500">{situation.detail}</p>
              )}
            </div>

            {situation && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Name it</label>
                    <input className="input" value={nLabel} onChange={(e) => setNLabel(e.target.value)}
                      placeholder="Group arriving in 3 days" />
                    <p className="mt-1 text-xs text-slate-400">Only for this list.</p>
                  </div>
                  <div>
                    <label className="label">Who gets it</label>
                    <select className="input" value={nAudience}
                      onChange={(e) => setNAudience(e.target.value as "staff" | "agent")}>
                      {situation.audiences.map((a) => (
                        <option key={a} value={a}>{a === "agent" ? "B2B agent" : "Staff"}</option>
                      ))}
                    </select>
                    {situation.audiences.length === 1 && (
                      <p className="mt-1 text-xs text-slate-400">
                        This situation has no agent behind it, so it can only go to staff.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label">Hours before {situation.anchor_label}</label>
                    <input className="input" value={nHours} onChange={(e) => setNHours(e.target.value)}
                      placeholder="72, 24" />
                    <p className="mt-1 text-xs text-slate-400">
                      One reminder per number, up to six. 72 is three days.
                    </p>
                  </div>
                  <div>
                    <label className="label">
                      {situation.anchor_label} happens at
                      <span className="ml-1 font-normal normal-case text-slate-400">· Saudi time</span>
                    </label>
                    <input type="time" className="input" value={nAnchorTime}
                      onChange={(e) => setNAnchorTime(e.target.value)} />
                    <p className="mt-1 text-xs text-slate-400">
                      Leave empty to count back from the start of that day.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="label">Title</label>
                  <input className="input" value={nTitle} onChange={(e) => setNTitle(e.target.value)}
                    placeholder="Group {group_no} arrives {arrival}" />
                </div>
                <div>
                  <label className="label">Message</label>
                  <textarea className="input min-h-[70px]" value={nBody}
                    onChange={(e) => setNBody(e.target.value)}
                    placeholder="{agency} · {pax} pax · arrival {arrival} (~{hours}h left)" />
                  <p className="mt-1 text-xs text-slate-400">
                    You can use: {tokenHelp(situation.placeholders)}
                    — anything else is refused when you save.
                  </p>
                </div>
              </>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button onClick={add} disabled={busy || !nSit} className="btn disabled:opacity-40">
                {busy ? "Adding…" : "Add reminder"}
              </button>
              <button onClick={() => { setAdding(false); setAddErr(null); }}
                className="rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
            {addErr && <p className="text-sm text-red-600">{addErr}</p>}
          </div>
        )}

        {table(reminders, "Reminder", "When")}
      </section>

      {/* ── event notifications ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-800">Notifications — sent when something happens</h2>
        <p className="text-sm text-slate-500">
          These have no clock: they go out the moment the thing happens. You can reword them or
          switch them off. What you cannot do is add a new one here — a new one means the ERP
          noticing something it does not notice today, and that is a code change rather than a
          setting.
        </p>
        {table(events, "Notification", "Fires")}
      </section>
    </div>
  );
}
