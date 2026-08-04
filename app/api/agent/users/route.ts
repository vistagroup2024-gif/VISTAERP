import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Owner/manager sub-user management. The httpOnly session token never reaches the
// client, so all mutations funnel through here and call the token-scoped RPCs
// (which enforce manage-users permission + the subset rule server-side).
export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const sb = createClient();
  const { action } = body;

  let rpc: string; let args: any;
  switch (action) {
    case "create":
      rpc = "b2b_create_user";
      args = { p_token: token, p_full_name: body.full_name, p_username: body.username, p_password: body.password,
        p_mobile: body.mobile ?? null, p_email: body.email ?? null, p_permissions: body.permissions ?? {} };
      break;
    case "update":
      rpc = "b2b_update_user";
      args = { p_token: token, p_id: body.id, p_full_name: body.full_name, p_mobile: body.mobile ?? null,
        p_email: body.email ?? null, p_status: body.status ?? null, p_permissions: body.permissions ?? null };
      break;
    case "password":
      rpc = "b2b_set_user_password"; args = { p_token: token, p_id: body.id, p_password: body.password };
      break;
    case "delete":
      rpc = "b2b_delete_user"; args = { p_token: token, p_id: body.id };
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const { data, error } = await sb.rpc(rpc, args);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data });
}
