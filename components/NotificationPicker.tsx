"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Cat = {
  category: string;
  label: string;
  description: string;
  gated_by: string | null;
  allowed_by_rights: boolean;
  on: boolean;
};

/**
 * Which notifications a user wants.
 *
 * Separate from RIGHTS, which decide what they may see at all. A manager holds
 * every right and is therefore told everything — 219 "Visa issued" notices and
 * the one voucher awaiting authorisation arriving through the same door, with
 * the useful one buried. This is where they turn the noise off.
 *
 * It can only turn things OFF. A category the user's rights exclude is shown
 * greyed with the reason, not hidden: an empty row would read as a setting that
 * had been left alone rather than one that is not theirs to make.
 *
 * `userId` set = an admin editing somebody else's; omitted = your own.
 */
export default function NotificationPicker({ userId }: { userId?: string }) {
  const supabase = createClient();
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("notify_prefs_get", { p_user: userId ?? null });
    if (error) return setErr(error.message);
    setCats(((data as any)?.categories ?? []) as Cat[]);
  }, [supabase, userId]);

  useEffect(() => { load(); }, [load]);

  async function toggle(category: string, on: boolean) {
    if (!cats) return;
    const next = cats.map((c) => (c.category === category ? { ...c, on } : c));
    setCats(next);
    setBusy(true); setErr(null); setMsg(null);
    const { error } = await supabase.rpc("notify_prefs_save", {
      p_off: next.filter((c) => !c.on).map((c) => c.category),
      p_user: userId ?? null,
    });
    setBusy(false);
    if (error) { setErr(error.message); load(); return; }
    setMsg("Saved.");
  }

  if (err && !cats) return <p className="text-sm text-red-600">{err}</p>;
  if (!cats) return <p className="text-sm text-slate-400">Loading…</p>;

  const offCount = cats.filter((c) => c.allowed_by_rights && !c.on).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold text-slate-800">Which notifications</h3>
        <span className="text-xs text-slate-400">
          {offCount === 0 ? "everything switched on" : `${offCount} switched off`}
        </span>
      </div>
      <p className="text-sm text-slate-500">
        Your rights decide what you <b>can</b> be told; this decides what you <b>want</b> to be told.
        Switching one off stops it reaching both the bell and your phone. It cannot turn on something
        your rights do not already allow.
      </p>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
        {cats.map((c) => {
          const blocked = !c.allowed_by_rights;
          return (
            <label key={c.category}
              className={`flex items-start gap-3 p-3 ${blocked ? "bg-slate-50" : "cursor-pointer hover:bg-brand-50/40"}`}>
              <input type="checkbox" className="mt-1" disabled={blocked || busy}
                checked={c.on && !blocked}
                onChange={(e) => toggle(c.category, e.target.checked)} />
              <div className="min-w-0">
                <div className={`text-sm font-medium ${blocked ? "text-slate-400" : "text-slate-800"}`}>
                  {c.label}
                </div>
                <div className="text-xs text-slate-500">{c.description}</div>
                {blocked && (
                  <div className="mt-1 text-xs text-amber-700">
                    Not available — you have no {c.gated_by} rights, so these are never sent to you.
                  </div>
                )}
              </div>
            </label>
          );
        })}
      </div>

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
