import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Staff notification feed / mark. Auth = Supabase session.
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "list") {
    const { data, error } = await supabase.rpc("notifications_feed");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, notifications: data ?? [] });
  }
  if (body.action === "mark") {
    const { error } = await supabase.rpc("notifications_mark", { p_id: body.id ?? null, p_action: body.op });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
