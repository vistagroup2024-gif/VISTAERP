import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Agent attachment proxy (B2B session cookie auth).
export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const supabase = createClient();

  if (b.action === "list") {
    const { data, error } = await supabase.rpc("b2b_attachment_list", { p_token: token, p_group: b.group });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, files: data ?? [] });
  }
  if (b.action === "add") {
    const { data, error } = await supabase.rpc("b2b_attachment_add", { p_token: token, p_group: b.group, p_name: b.name, p_mime: b.mime, p_size: b.size, p_data: b.data });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  if (b.action === "get") {
    const { data, error } = await supabase.rpc("b2b_attachment_get", { p_token: token, p_id: b.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, file: data });
  }
  if (b.action === "delete") {
    const { error } = await supabase.rpc("b2b_attachment_delete", { p_token: token, p_id: b.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
