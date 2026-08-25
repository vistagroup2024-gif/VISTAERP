import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPush, pushConfigured, VAPID_PUBLIC } from "@/lib/webpush";

export const dynamic = "force-dynamic";

// Staff device management + test send. Auth = Supabase session.
export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));

  if (b.action === "vapid") return NextResponse.json({ key: VAPID_PUBLIC, configured: pushConfigured() });

  if (b.action === "subscribe") {
    const { error } = await sb.rpc("push_subscribe", { p_endpoint: b.endpoint, p_p256dh: b.p256dh, p_auth: b.auth, p_ua: b.ua ?? null });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "unsubscribe") {
    const { error } = await sb.rpc("push_unsubscribe", { p_endpoint: b.endpoint });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "list") {
    const { data, error } = await sb.rpc("push_my_devices");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, devices: data ?? [] });
  }
  if (b.action === "test") {
    if (!pushConfigured()) return NextResponse.json({ error: "Push not configured on the server (VAPID_PRIVATE_KEY missing)." }, { status: 400 });
    const { data } = await sb.rpc("push_my_subscriptions");
    const subs = (data ?? []) as any[];
    if (subs.length === 0) return NextResponse.json({ error: "No devices registered on this account." }, { status: 400 });
    const { ok } = await sendPush(subs, { title: "Vista ERP test 🔔", body: "Push notifications are working on this device.", link: "/settings/notifications", tag: "test" });
    return NextResponse.json({ ok: true, sent: ok.length });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
