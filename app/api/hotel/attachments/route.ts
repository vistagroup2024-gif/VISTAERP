import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Staff attachment proxy for Hotel bookings (Supabase session auth).
// Mirrors /api/transport/attachments but backed by hotel_attachment_* RPCs.
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));

  if (b.action === "list") {
    const { data, error } = await supabase.rpc("hotel_attachment_list", { p_booking: b.group });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, files: data ?? [] });
  }
  if (b.action === "add") {
    const { data, error } = await supabase.rpc("hotel_attachment_add", { p_booking: b.group, p_name: b.name, p_mime: b.mime, p_size: b.size, p_data: b.data, p_category: b.category ?? null });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  if (b.action === "get") {
    const { data, error } = await supabase.rpc("hotel_attachment_get", { p_id: b.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, file: data });
  }
  if (b.action === "delete") {
    const { error } = await supabase.rpc("hotel_attachment_delete", { p_id: b.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
