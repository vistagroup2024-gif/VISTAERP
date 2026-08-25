// Build a WhatsApp click-to-chat deep link from a stored phone number.
// Conservative country-code handling: only add the default code when the number is
// unambiguously a local one; otherwise use it as-is or return null (never guess).

const DEFAULT_CC = process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE || "966"; // Saudi Arabia

// Returns E.164 digits with no '+', or null if a valid number can't be determined.
export function normalizeWa(input: string | null | undefined, cc: string = DEFAULT_CC): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  const intl = raw.startsWith("+") || raw.startsWith("00");
  let d = raw.replace(/\D/g, "");
  d = d.replace(/^0+(?=\d)/, (m) => (intl ? m : "")); // strip a single leading local 0 only for local numbers
  if (intl) {
    d = d.replace(/^00/, "");
    return d.length >= 10 ? d : null;
  }
  // Already includes a country code (e.g. 9665XXXXXXXX)?
  if (d.startsWith(cc) && d.length >= cc.length + 8) return d;
  // KSA local mobile: 9 digits starting with 5 (after dropping the leading 0).
  if (/^5\d{8}$/.test(d)) return cc + d;
  // 10-digit local starting 05 already had its 0 stripped above → handled by the 5-rule.
  // A long number with no + but >= 11 digits: assume it already carries a country code.
  if (d.length >= 11) return d;
  return null;
}

export function hasWa(input: string | null | undefined): boolean {
  return normalizeWa(input) !== null;
}

// Full wa.me deep link with an optional pre-filled message, or null if no valid number.
export function waHref(input: string | null | undefined, message?: string | null): string | null {
  const n = normalizeWa(input);
  if (!n) return null;
  const base = `https://wa.me/${n}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
