import { NextResponse } from "next/server";

/**
 * The gate on a scheduled job's endpoint.
 *
 * These routes are outside staff auth — the scheduler has no Supabase session —
 * so CRON_SECRET is the only thing standing in front of them, and a job that
 * generates charges, posts to the ledger or raises notifications is not
 * something to leave open. Both routes used to check the secret only WHEN ONE
 * WAS SET, which read as safe because the auth middleware was turning every
 * caller away at the door; it was also why neither job had ever run. Now that
 * they are reachable, an unset secret has to refuse rather than wave everybody
 * through.
 *
 * Returns null when the caller is allowed, or the response to send back.
 */
export function cronDenied(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({
      ok: false,
      error: "CRON_SECRET is not set — this job refuses to run rather than accept anonymous callers. Set it in the deployment environment.",
    }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret")
    || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
