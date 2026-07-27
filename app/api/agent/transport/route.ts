import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Agent transport proxy (B2B session cookie auth). All access is scoped to the
// session agent by the b2b_transport_* SECURITY DEFINER functions.
export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const supabase = createClient();

  if (b.action === "masters") {
    const { data, error } = await supabase.rpc("b2b_transport_masters", { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, masters: data });
  }
  if (b.action === "list") {
    const { data, error } = await supabase.rpc("b2b_transport_my_bookings", { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, bookings: data ?? [] });
  }
  if (b.action === "get") {
    const { data, error } = await supabase.rpc("b2b_transport_get_booking", { p_token: token, p_id: b.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, ...(data ?? {}) });
  }
  if (b.action === "save") {
    const { data, error } = await supabase.rpc("b2b_transport_save_booking", {
      p_token: token, p_id: b.id ?? null, p_header: b.header, p_trips: b.trips,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
