import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsApp } from "@/lib/whatsapp";

// Admin diagnostic for the WhatsApp Cloud API configuration.
//   GET  -> reports which phone number id / token the running deployment is
//           actually using and verifies the token can load that number.
//   POST -> sends a one-off test message to a given number.
// Staff-only. The token is never returned in full (last 4 digits only).

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const out: any = {
    tokenSet: !!token,
    tokenLast4: token ? token.slice(-4) : null,
    phoneNumberId: phoneId ?? null,
    apiVersion: version,
    template: process.env.WHATSAPP_TEMPLATE || null,
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG || "en",
  };
  if (!token || !phoneId) {
    return NextResponse.json({ ...out, ok: false, error: "Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in the environment." });
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${version}/${phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ ...out, ok: false, error: j?.error?.message || `Graph API error ${res.status}`, metaCode: j?.error?.code });
    }
    return NextResponse.json({ ...out, ok: true, displayPhoneNumber: j.display_phone_number, verifiedName: j.verified_name, qualityRating: j.quality_rating, codeVerificationStatus: j.code_verification_status });
  } catch (e: any) {
    return NextResponse.json({ ...out, ok: false, error: e?.message || "Network error contacting Meta." });
  }
}

export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const b = await req.json().catch(() => ({}));
  if (!b?.to) return NextResponse.json({ error: "Provide a 'to' number." }, { status: 400 });
  const r = await sendWhatsApp(b.to, b.body || "VISTA ERP WhatsApp test message ✅");
  return NextResponse.json(r);
}
