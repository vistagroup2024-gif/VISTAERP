import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  const supabase = createClient();
  const { data, error } = await supabase.rpc("login_b2b", { p_username: username, p_password: password });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Invalid username or password" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("b2b_session", data as string, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
