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
 * This is the missing ask, and it is a DIALOG rather than a banner because a
 * banner is a thing people learn to look past. Notifications cannot be turned
 * on for somebody: every browser requires the person to click Allow on a prompt
 * the browser itself draws, in response to a real click. No website can grant
 * itself that, which is the whole point of the permission. So the most that can
 * be done is to make the ask unmissable and one press long — which is what this
 * is. Answering it either way puts it away; "Not now" is remembered for a
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
    <div className="no-print fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
         role="dialog" aria-modal="true" aria-labelledby="push-nudge-title">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-pop">
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-brand-50 text-xl" aria-hidden>🔔</div>

        {state === "done" ? (
          <>
            <h2 id="push-nudge-title" className="text-base font-semibold text-green-700">You are all set ✓</h2>
            <p className="mt-1 text-sm text-slate-600">
              This device will now be alerted even when the ERP is closed.
            </p>
          </>
        ) : state === "ios" ? (
          <>
            <h2 id="push-nudge-title" className="text-base font-semibold text-slate-800">One step on iPhone</h2>
            <p className="mt-1 text-sm text-slate-600">
              iPhone only allows notifications once the app is on your Home Screen. Tap <b>Share</b> →
              <b> Add to Home Screen</b>, then open Vista ERP from the new icon and turn them on there.
            </p>
          </>
        ) : state === "denied" ? (
          <>
            <h2 id="push-nudge-title" className="text-base font-semibold text-slate-800">Notifications are blocked</h2>
            <p className="mt-1 text-sm text-slate-600">
              This site is blocked from sending notifications. Tap the lock icon next to the address bar →
              <b> Permissions</b> → <b>Notifications</b> → <b>Allow</b>, then reload the page.
            </p>
          </>
        ) : (
          <>
            <h2 id="push-nudge-title" className="text-base font-semibold text-slate-800">Turn on notifications?</h2>
            <p className="mt-1 text-sm text-slate-600">
              Be alerted on this device even when the ERP is closed — approvals, arrivals, payments and
              the work in your own modules. Your browser will ask you to allow it once.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              You can turn this off again at any time in Settings → Phone Notifications.
            </p>
          </>
        )}

        <div className="mt-5 flex items-center gap-2">
          {state === "ask" && (
            <button onClick={turnOn} disabled={busy} className="btn flex-1 text-sm">
              {busy ? "Setting up…" : "Turn on notifications"}
            </button>
          )}
          {state === "done" ? (
            <button onClick={() => setShow(false)} className="btn flex-1 text-sm">Done</button>
          ) : (
            <button onClick={close} className="btn-outline text-sm">
              {state === "ask" ? "Not now" : "Close"}
            </button>
          )}
        </div>

        {state !== "done" && (
          <Link href="/settings/notifications" onClick={close}
            className="mt-3 block text-center text-xs text-brand hover:underline">
            Open notification settings
          </Link>
        )}
      </div>
    </div>
  );
}
