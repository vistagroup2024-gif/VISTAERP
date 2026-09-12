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

// Send to a list of subscriptions. Returns which endpoints succeeded, which are
// dead (410/404) so the caller can prune them, and which failed for any other
// reason so the caller can LOG them — a failure that is neither "ok" nor "dead"
// used to vanish here, which is how a push could stop reaching a device with
// nothing anywhere saying so.
//
// URGENCY IS HIGH, AND THAT IS THE FIX FOR "NOTHING ARRIVES UNTIL I OPEN THE
// APP". Web Push defaults to Urgency: normal, and on Android a normal-urgency
// message is allowed to wait: Chrome in Doze / under battery optimisation does
// not wake for it, FCM holds it, and it is delivered the moment the browser
// next comes to the foreground — i.e. when the user opens the ERP, which is
// exactly the symptom. Urgency: high asks the push service to deliver
// immediately and wake the device. Every notification the ERP raises is
// something a person is meant to act on, so none of them is "normal".
//
// TTL is a day rather than the library's four-week default: a reminder that
// could not be delivered for 24 hours is stale, and a phone switched on after a
// week should not receive a burst of last week's alerts.
//
// topic = tag collapses repeats: if the same notification id is pushed twice
// before the device wakes, the push service keeps only the newest.
export async function sendPush(subs: Sub[], payload: Payload) {
  ensure();
  const data = JSON.stringify(payload);
  const ok: string[] = [];
  const dead: string[] = [];
  const failed: { endpoint: string; status?: number; message: string }[] = [];
  // A topic must be at most 32 URL-safe characters; a uuid tag is 36, so it is
  // squeezed to fit rather than dropped.
  const topic = payload.tag ? payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : undefined;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
          { urgency: "high", TTL: 86400, ...(topic ? { topic } : {}) },
        );
        ok.push(s.endpoint);
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
        else failed.push({ endpoint: s.endpoint, status: code, message: String(e?.body || e?.message || e) });
      }
    })
  );
  return { ok, dead, failed };
}
