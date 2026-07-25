import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Admin Company Recommendation proxy. Auth = Supabase (staff) session.
export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "recommend") {
    const { data, error } = await supabase.rpc("recommend_companies", {
      p_arrival: body.arrival, p_departure: body.departure, p_pax: body.pax,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, results: data ?? [] });
  }
  if (body.action === "reserve") {
    const { data, error } = await supabase.rpc("create_company_reservation", {
      p_company: body.company, p_arrival: body.arrival, p_departure: body.departure,
      p_pax: body.pax, p_source: "admin", p_created_by: user.email ?? "staff", p_agent_id: null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  if (body.action === "release") {
    const { error } = await supabase.rpc("release_company_reservation", { p_id: body.id });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "set_minutes") {
    const { error } = await supabase.rpc("set_setting", { p_key: "company_reservation_minutes", p_value: String(body.minutes) });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "form_list") {
    const { data, error } = await supabase.rpc("form_reservations", { p_company: body.company });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, reservations: data ?? [] });
  }
  if (body.action === "link") {
    const { error } = await supabase.rpc("link_reservation_to_group", { p_reservation: body.reservation, p_group: body.group });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "list") {
    const [{ data: reservations }, { data: minutes }] = await Promise.all([
      supabase.rpc("active_reservations"),
      supabase.rpc("get_setting", { p_key: "company_reservation_minutes", p_default: "20" }),
    ]);
    return NextResponse.json({ ok: true, reservations: reservations ?? [], minutes: minutes ?? "20" });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
