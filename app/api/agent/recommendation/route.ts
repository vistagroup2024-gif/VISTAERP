import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Agent Company Recommendation proxy. Auth = B2B session cookie token.
export async function POST(req: Request) {
  const token = cookies().get("b2b_session")?.value;
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const supabase = createClient();

  if (body.action === "recommend") {
    const { data, error } = await supabase.rpc("b2b_recommend_companies", {
      p_token: token, p_arrival: body.arrival, p_departure: body.departure, p_pax: body.pax,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, results: data ?? [] });
  }
  if (body.action === "reserve") {
    const { data, error } = await supabase.rpc("b2b_create_company_reservation", {
      p_token: token, p_company: body.company, p_arrival: body.arrival, p_departure: body.departure, p_pax: body.pax,
      p_hours: body.hours ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  if (body.action === "form_list") {
    const { data, error } = await supabase.rpc("b2b_form_reservations", { p_token: token, p_company: body.company });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, reservations: data ?? [] });
  }
  if (body.action === "list") {
    const { data, error } = await supabase.rpc("b2b_active_reservations", { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, reservations: data ?? [] });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
