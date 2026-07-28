import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const token = cookies().get("vendor_session")?.value;
  if (token) { const sb = createClient(); await sb.rpc("logout_vendor", { p_token: token }); }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("vendor_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
