import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const supabase = createClient();

  if (body.action === "create") {
    const { data, error } = await supabase.rpc("b2b_create_group", { p_token: token, p: body.payload });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  if (body.action === "update") {
    const { error } = await supabase.rpc("b2b_update_group", { p_token: token, p_group: body.id, p: body.payload });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: body.id });
  }
  if (body.action === "hotel") {
    const { error } = await supabase.rpc("b2b_update_hotel_details", { p_token: token, p_group: body.id, p_hotels: body.hotels });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: body.id });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
