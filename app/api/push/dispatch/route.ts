import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPush, pushConfigured } from "@/lib/webpush";

export const dynamic = "force-dynamic";

// Called by the Postgres trigger (pg_net) on every new notification. Loads the target
// device subscriptions via a secret-guarded RPC and sends the Web Push messages.
export async function POST(req: Request) {
  const { id, secret } = await req.json().catch(() => ({} as any));
  if (!id || !secret) return NextResponse.json({ error: "bad request" }, { status: 400 });
  if (!pushConfigured()) return NextResponse.json({ ok: false, skipped: "VAPID not configured" });

  const sb = createClient();
  const { data, error } = await sb.rpc("push_dispatch_targets", { p_secret: secret, p_notification: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  const d = data as any;
  if (!d?.found) return NextResponse.json({ ok: true, found: false });

  const subs = (d.subs ?? []) as any[];
  if (subs.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  const { ok, dead, failed } = await sendPush(subs, { title: d.title, body: d.body, link: d.link, tag: id });
  if (ok.length) await sb.rpc("push_mark_notified", { p_secret: secret, p_endpoints: ok });
  if (dead.length) await sb.rpc("push_prune", { p_secret: secret, p_endpoints: dead });
  // A send that is neither delivered nor dead is the one worth reading about in
  // the runtime logs — a VAPID mismatch (401/403) or a payload too large (413)
  // looks, from the outside, exactly like "the notification never came".
  if (failed.length) {
    console.error("push dispatch: %d of %d sends failed for notification %s", failed.length, subs.length, id,
      failed.map((f) => `${f.status ?? "?"} ${f.message.slice(0, 160)}`));
  }
  return NextResponse.json({ ok: true, sent: ok.length, pruned: dead.length, failed: failed.length });
}
