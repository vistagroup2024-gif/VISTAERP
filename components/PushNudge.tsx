"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { pushSupported, permissionState, currentEndpoint, enablePush, isIos, isStandalone } from "@/lib/push";

/**
 * "Turn on notifications" — asked once, where people actually are.
 *
 * Push is per device and opt-in: a row in push_subscriptions is only written
 * when somebody presses Turn On. `enablePush` was called from exactly one place
 * in the ERP — Settings → Phone Notifications — and nothing ever pointed anybody
 * at it. So four of the five staff accounts had no device registered at all and
 * got nothing on their phone while the ERP was closed, which read as a broken
 * feature rather than an unvisited screen.
 *
 * This is the missing ask. It shows only to somebody who has not set this
 * browser up, it turns push on in place, and a dismissal is remembered for a
 * fortnight so it is a reminder rather than a nag.
 *
 * It deliberately does NOT call the server to decide whether to appear: browser
 * permission plus an existing PushManager subscription is enough to know this
 * device is set up, and asking the server would put a request on every page load
 * for every user forever.
 */

const DISMISS_KEY = "vista:push:nudge:dismissed";
const SNOOZE_DAYS = 14;

function snoozed(): boolean {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Number.isFinite(t) && Date.now() - t < SNOOZE_DAYS * 86400_000;
  } catch { return false; }
}
function snooze() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private window */ }
}

export default function PushNudge() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"ask" | "ios" | "denied" | "done">("ask");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!pushSupported()) {
        // iPhone before Add to Home Screen: push genuinely cannot work yet, and
        // the fix is a thing the user does, so it is worth saying once.
        if (isIos() && !isStandalone() && !snoozed()) { setState("ios"); setShow(true); }
        return;
      }
      if (snoozed()) return;
      const perm = permissionState();
      if (perm === "denied") { setState("denied"); setShow(true); return; }
      const ep = await currentEndpoint();
      if (!alive) return;
      // Granted AND subscribed on this browser means this device is set up.
      if (perm === "granted" && ep) return;
      setState("ask"); setShow(true);
    })();
    return () => { alive = false; };
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      await enablePush("/api/push");
      setState("done");
      setTimeout(() => setShow(false), 2500);
    } catch (e: any) {
      if (e?.message === "ios-install") setState("ios");
      else if (e?.message === "denied") setState("denied");
      // "dismissed" leaves the banner as it is so the button can be pressed again
    } finally { setBusy(false); }
  }

  function close() { snooze(); setShow(false); }

  if (!show) return null;

  return (
    <div className="no-print mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm">
      <span className="text-base" aria-hidden>🔔</span>

      {state === "done" ? (
        <span className="font-medium text-green-700">This device will now get notifications. ✓</span>
      ) : state === "ios" ? (
        <span className="min-w-0 text-slate-700">
          To get notifications on your iPhone, add Vista ERP to your Home Screen: tap <b>Share</b> →
          <b> Add to Home Screen</b>, then open it from the new icon.
        </span>
      ) : state === "denied" ? (
        <span className="min-w-0 text-slate-700">
          Notifications are <b>blocked</b> for this site. Tap the lock icon next to the address bar →
          <b> Permissions</b> → <b>Notifications</b> → Allow, then reload.
        </span>
      ) : (
        <span className="min-w-0 text-slate-700">
          Get notified on this device even when the ERP is closed.
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-2">
        {state === "ask" && (
          <button onClick={turnOn} disabled={busy} className="btn text-xs">
            {busy ? "Setting up…" : "Turn on"}
          </button>
        )}
        {state !== "done" && (
          <Link href="/settings/notifications" className="text-xs text-brand hover:underline">Settings</Link>
        )}
        <button onClick={close} aria-label="Dismiss" title="Not now"
          className="rounded px-1.5 text-slate-400 hover:bg-white hover:text-slate-600">✕</button>
      </span>
    </div>
  );
}
