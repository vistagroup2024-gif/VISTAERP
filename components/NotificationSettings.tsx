"use client";

import { useCallback, useEffect, useState } from "react";
import { pushSupported, permissionState, enablePush, disablePush, listDevices, removeDevice, sendTest, currentEndpoint, isIos, isStandalone } from "@/lib/push";

type Device = { id: string; endpoint: string; ua: string | null; enabled: boolean; last_notified: string | null; created_at: string };

function deviceLabel(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : "Device";
  const br = /Edg/i.test(ua) ? "Edge" : /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Browser";
  return `${os} • ${br}`;
}
function ago(iso: string | null) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Reusable phone-notification manager. `endpoint` = /api/push (staff) or /api/agent/push.
export default function NotificationSettings({ endpoint = "/api/push" }: { endpoint?: string }) {
  const [supported, setSupported] = useState(true);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [devices, setDevices] = useState<Device[]>([]);
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setDevices(await listDevices(endpoint)); } catch { /* not signed in */ }
    setThisEndpoint(await currentEndpoint());
  }, [endpoint]);

  useEffect(() => {
    setSupported(pushSupported());
    setPerm(permissionState());
    refresh();
  }, [refresh]);

  const [needIosInstall, setNeedIosInstall] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  async function turnOn() {
    setBusy(true); setErr(null); setMsg(null); setDismissed(false); setNeedIosInstall(false);
    try { await enablePush(endpoint); setPerm(permissionState()); setMsg("This device is now set up for notifications."); await refresh(); }
    catch (e: any) {
      if (e.message === "denied") setPerm("denied");
      else if (e.message === "ios-install") setNeedIosInstall(true);
      else if (e.message === "dismissed") setDismissed(true);
      else setErr(e.message);
    }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setErr(null); setMsg(null);
    try { await sendTest(endpoint); setMsg("Test notification sent — check your device."); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(d: Device) {
    setBusy(true); setErr(null);
    try {
      if (d.endpoint === thisEndpoint) await disablePush(endpoint, d.endpoint);
      else await removeDevice(endpoint, d.endpoint);
      await refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const thisRegistered = !!thisEndpoint && devices.some((d) => d.endpoint === thisEndpoint);

  if (!supported) {
    return <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">This browser doesn’t support push notifications. Try Chrome on Android, or install the app to your home screen.</div>;
  }

  return (
    <div className="space-y-4">
      {msg && <div className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
      {err && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div className="card">
        <h3 className="font-semibold text-slate-700">Phone notifications</h3>
        {needIosInstall || (isIos() && !isStandalone()) ? (
          <div className="mt-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
            On iPhone/iPad, notifications work only after you <b>add this app to your Home Screen</b>: tap the
            <b> Share</b> icon → <b>Add to Home Screen</b>, then open Vista ERP from the new icon and press Turn On here.
          </div>
        ) : dismissed ? (
          <div className="mt-2 space-y-2">
            <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
              The permission prompt was dismissed. Press <b>Turn On</b> again and choose <b>Allow</b> when the browser asks.
            </div>
            <button onClick={turnOn} disabled={busy} className="btn text-sm">{busy ? "Setting up…" : "Turn On"}</button>
          </div>
        ) : perm === "denied" ? (
          <div className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Notifications are <b>blocked</b> for this site in your browser. To enable them: open the site settings
            (tap the lock/ⓘ icon next to the address bar → <b>Permissions</b> → <b>Notifications</b> → Allow), then reload and press Turn On.
          </div>
        ) : thisRegistered ? (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">This device is set up ✓</span>
            <button onClick={test} disabled={busy} className="btn-outline text-sm">Send a test</button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-500">This device is not set up yet.</span>
            <button onClick={turnOn} disabled={busy} className="btn text-sm">{busy ? "Setting up…" : "Turn On"}</button>
          </div>
        )}
      </div>

      <div className="card p-0">
        <div className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-700">Your devices ({devices.length})</div>
        <ul>
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 border-b border-slate-50 px-4 py-3 text-sm">
              <div>
                <div className="font-medium text-slate-800">{deviceLabel(d.ua)}{d.endpoint === thisEndpoint && <span className="ml-2 text-xs text-brand">this device</span>}</div>
                <div className="text-xs text-slate-400">Last notified: {ago(d.last_notified)}</div>
              </div>
              <div className="ml-auto flex gap-2">
                {d.endpoint === thisEndpoint && <button onClick={test} disabled={busy} className="text-xs text-brand hover:underline">Send a test</button>}
                <button onClick={() => remove(d)} disabled={busy} className="text-xs text-red-500 hover:underline">Remove</button>
              </div>
            </li>
          ))}
          {devices.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-400">No devices registered yet.</li>}
        </ul>
      </div>
    </div>
  );
}
