import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Vendor portal proxy (vendor_session cookie). Scoped by the vendor_* SECURITY
// DEFINER functions.
export async function POST(req: Request) {
  const token = cookies().get("vendor_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const supabase = createClient();

  if (b.action === "list") {
    const { data, error } = await supabase.rpc("vendor_trips", { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, ...(data as any) });
  }
  if (b.action === "accept") {
    const { error } = await supabase.rpc("vendor_accept_trip", { p_token: token, p_trip: b.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
