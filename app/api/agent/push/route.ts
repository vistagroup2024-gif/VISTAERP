import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { sendPush, pushConfigured, VAPID_PUBLIC } from "@/lib/webpush";

export const dynamic = "force-dynamic";

// Agent-portal device management + test send. Auth = B2B session cookie token.
export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const sb = createClient();
  const b = await req.json().catch(() => ({} as any));

  if (b.action === "vapid") return NextResponse.json({ key: VAPID_PUBLIC, configured: pushConfigured() });
  if (b.action === "subscribe") {
    const { error } = await sb.rpc("b2b_push_subscribe", { p_token: token, p_endpoint: b.endpoint, p_p256dh: b.p256dh, p_auth: b.auth, p_ua: b.ua ?? null });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "unsubscribe") {
    const { error } = await sb.rpc("b2b_push_unsubscribe", { p_token: token, p_endpoint: b.endpoint });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "list") {
    const { data, error } = await sb.rpc("b2b_push_devices", { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, devices: data ?? [] });
  }
  if (b.action === "test") {
    if (!pushConfigured()) return NextResponse.json({ error: "Push not configured on the server." }, { status: 400 });
    const { data } = await sb.rpc("b2b_push_subscriptions", { p_token: token });
    const subs = (data ?? []) as any[];
    if (subs.length === 0) return NextResponse.json({ error: "No devices registered." }, { status: 400 });
    const { ok } = await sendPush(subs, { title: "Vista B2B test 🔔", body: "Push notifications are working on this device.", link: "/agent/settings/notifications", tag: "test" });
    return NextResponse.json({ ok: true, sent: ok.length });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
