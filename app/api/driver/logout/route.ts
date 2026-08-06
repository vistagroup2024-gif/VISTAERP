import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const token = cookies().get("driver_session")?.value;
  if (token) await createClient().rpc("logout_transport", { p_token: token });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("driver_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
