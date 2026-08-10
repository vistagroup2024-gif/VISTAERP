import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Agent hotel proxy (B2B session cookie auth). Access is scoped to the session
// agent by the b2b_hotel_* SECURITY DEFINER functions (client-safe fields only).
export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const supabase = createClient();

  if (b.action === "create") {
    const { data, error } = await supabase.rpc("b2b_hotel_create", { p_token: token, p: b.payload });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
