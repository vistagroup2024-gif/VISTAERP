import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Agent notification feed / mark. Auth = B2B session cookie token.
export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const supabase = createClient();

  if (body.action === "list") {
    const { data, error } = await supabase.rpc("b2b_notifications_feed", { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, notifications: data ?? [] });
  }
  if (body.action === "mark") {
    const { error } = await supabase.rpc("b2b_notifications_mark", { p_token: token, p_id: body.id ?? null, p_action: body.op });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
