// WhatsApp sender — Meta WhatsApp Cloud API.
//
// Required env (set in Vercel / .env):
//   WHATSAPP_TOKEN            System-user / permanent access token
//   WHATSAPP_PHONE_NUMBER_ID  The Cloud API phone number id (NOT the phone number)
// Optional:
//   WHATSAPP_API_VERSION      Graph API version (default v21.0)
//   WHATSAPP_TEMPLATE         Approved template name. If set, messages are sent as
//                             a template with the whole body as one {{1}} parameter
//                             (required by Meta for business-initiated messages
//                             outside the 24h customer window). If unset, a plain
//                             text message is sent (works in the 24h window / testing).
//   WHATSAPP_TEMPLATE_LANG    Template language code (default en)

export interface WaResult { ok: boolean; id?: string; error?: string; skipped?: boolean }

// Meta expects E.164 digits with no '+', spaces or dashes (e.g. 9665XXXXXXXX).
export function normalizeWaNumber(input: string | null | undefined): string | null {
  if (!input) return null;
  let n = String(input).replace(/[^\d+]/g, "");
  n = n.replace(/^\+/, "");
  n = n.replace(/^00/, "");
  return n.length >= 8 ? n : null;
}

export function whatsappConfigured(): boolean {
  return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export async function sendWhatsApp(to: string | null | undefined, body: string): Promise<WaResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    return { ok: false, skipped: true, error: "WhatsApp not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)." };
  }
  const number = normalizeWaNumber(to);
  if (!number) return { ok: false, error: "No valid WhatsApp number for this recipient." };

  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const template = process.env.WHATSAPP_TEMPLATE;
  const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;

  const payload: any = template
    ? {
        messaging_product: "whatsapp", to: number, type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
          components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
        },
      }
    : { messaging_product: "whatsapp", to: number, type: "text", text: { preview_url: false, body } };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `WhatsApp API error (${res.status})` };
    }
    return { ok: true, id: json?.messages?.[0]?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error contacting WhatsApp." };
  }
}
