// Server-side Web Push sender (VAPID). Used by the dispatch + test routes.
import webpush from "web-push";

// The public key is safe to expose; the private key + subject are server-only.
export const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BAB_Xh3d2XmaAp5SErf0MAkASfevMfeRIyJWSIN64fTSl0pwr_6v0Pa_FRDji0-tsdER1AkCrJ4j4x1m0lw1Pek";

let configured = false;
export function pushConfigured(): boolean {
  return !!process.env.VAPID_PRIVATE_KEY;
}
function ensure() {
  if (configured) return;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) throw new Error("VAPID_PRIVATE_KEY not set");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@vista-group.co", VAPID_PUBLIC, priv);
  configured = true;
}

export type Sub = { endpoint: string; p256dh: string; auth: string };
export type Payload = { title: string; body?: string | null; link?: string; tag?: string };

// Send to a list of subscriptions. Returns which endpoints succeeded and which are
// dead (410/404) so the caller can prune them.
export async function sendPush(subs: Sub[], payload: Payload) {
  ensure();
  const data = JSON.stringify(payload);
  const ok: string[] = [];
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data);
        ok.push(s.endpoint);
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
      }
    })
  );
  return { ok, dead };
}
