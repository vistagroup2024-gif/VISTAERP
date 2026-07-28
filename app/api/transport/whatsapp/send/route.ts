import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";

// Sends transport_outbox WhatsApp messages via the Meta Cloud API.
// Staff-only (Supabase auth). Reads/updates run under the caller's RLS.
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!whatsappConfigured()) {
    return NextResponse.json({ error: "WhatsApp is not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID." }, { status: 400 });
  }

  const b = await req.json().catch(() => ({}));

  // Build the working set: a single row, or all queued whatsapp rows.
  let rows: any[] = [];
  if (b.id) {
    const { data } = await supabase.from("transport_outbox").select("id, to_addr, body, channel, status").eq("id", b.id).limit(1);
    rows = data ?? [];
  } else if (b.action === "send_queued") {
    const { data } = await supabase.from("transport_outbox").select("id, to_addr, body, channel, status").eq("status", "queued").eq("channel", "whatsapp").limit(100);
    rows = data ?? [];
  } else {
    return NextResponse.json({ error: "Provide an id or action:'send_queued'." }, { status: 400 });
  }

  let sent = 0, failed = 0;
  for (const row of rows) {
    if (row.channel !== "whatsapp") continue;
    const r = await sendWhatsApp(row.to_addr, row.body ?? "");
    if (r.ok) {
      sent++;
      await supabase.from("transport_outbox").update({ status: "sent", sent_at: new Date().toISOString(), provider: "whatsapp_cloud", provider_id: r.id ?? null, error: null }).eq("id", row.id);
    } else {
      failed++;
      await supabase.from("transport_outbox").update({ status: "failed", provider: "whatsapp_cloud", error: r.error ?? "Send failed" }).eq("id", row.id);
    }
  }

  return NextResponse.json({ ok: true, sent, failed, total: rows.length });
}
