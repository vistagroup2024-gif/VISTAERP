import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const token = cookies().get("b2b_session")?.value;
  if (token) {
    const supabase = createClient();
    await supabase.rpc("logout_b2b", { p_token: token });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("b2b_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
