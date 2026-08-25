// Client-side push subscription manager. Handles permission, service-worker
// registration, PushManager subscribe/unsubscribe, and talks to the given endpoint
// (/api/push for staff, /api/agent/push for agents).

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export function permissionState(): NotificationPermission {
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}

async function api(endpoint: string, body: any) {
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Request failed");
  return json;
}

// Turn on: request permission, register SW, subscribe, save on the server.
export async function enablePush(endpoint: string): Promise<{ endpoint: string }> {
  if (!pushSupported()) throw new Error("This browser does not support notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "denied" : "Permission not granted.");

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const { key, configured } = await api(endpoint, { action: "vapid" });
  if (!configured) throw new Error("Push is not configured on the server yet (VAPID keys).");

  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource });

  const json = sub.toJSON() as any;
  await api(endpoint, {
    action: "subscribe", endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh, auth: json.keys?.auth, ua: navigator.userAgent,
  });
  return { endpoint: sub.endpoint };
}

// Remove this browser's subscription (server + local).
export async function disablePush(endpoint: string, subEndpoint?: string) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    const ep = subEndpoint || sub?.endpoint;
    if (ep) await api(endpoint, { action: "unsubscribe", endpoint: ep });
    if (sub) await sub.unsubscribe();
  } catch { /* ignore */ }
}

export async function listDevices(endpoint: string) {
  const { devices } = await api(endpoint, { action: "list" });
  return devices as any[];
}
export async function removeDevice(endpoint: string, subEndpoint: string) {
  await api(endpoint, { action: "unsubscribe", endpoint: subEndpoint });
}
export async function sendTest(endpoint: string) {
  return api(endpoint, { action: "test" });
}
export async function currentEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch { return null; }
}
