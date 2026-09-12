import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { docForPath, hasDocRight, type DocRightsMap } from "@/lib/docRights";
import { landingFor } from "@/lib/landing";

// Route -> permissions that grant access (any-of). Longest matching prefix wins.
// Unlisted routes are not permission-gated. Mirrors the sidebar gating.
const ROUTE_PERMS: [string, string[]][] = [
  ["/dashboard", ["dashboard.view"]],
  ["/groups", ["visa.view"]],
  ["/visa/invoices", ["visa.invoices"]],
  ["/inventory", ["brn.view", "brn.planning", "visa.view"]],
  ["/sales", ["sales.view"]],
  ["/packages", ["sales.view"]],
  ["/invoices", ["sales.view"]],
  ["/hotels", ["hotels.masters", "hotels.bookings", "hotels.suppliers", "hotels.hcn", "hotels.reports", "hotels.purchase"]],
  ["/transport", ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.reports", "transport.driver_assign", "transport.trip_ledger"]],
  ["/car-sales", ["carsales.view", "carsales.vehicles", "carsales.sales", "carsales.installments", "carsales.receipts", "carsales.charges", "carsales.ownership", "carsales.reports", "carsales.accounting"]],
  ["/purchase", ["purchase.view"]],
  ["/accounting", ["accounting.view"]],
  // Customers, agents and suppliers live in the chart now, so the permission
  // that used to open their own screen opens this one. Longest prefix wins.
  ["/accounting/accounts", ["accounting.view", "parties.manage"]],
  ["/settings/users", ["users.view"]],
  ["/settings/roles", ["users.view", "users.manage_roles"]],
  ["/settings/agents", ["users.view"]],
  ["/settings/companies", ["system.companies", "system.config", "system.masters"]],
];


/** Gives a promise a deadline, and says which one ran out.
 *
 *  THE MIDDLEWARE MAKES TWO NETWORK CALLS ON EVERY REQUEST — the Supabase auth
 *  server for the user, then staff_access() for the permissions — and neither
 *  had a bound on it. Production has recorded 12 requests killed by Vercel at
 *  its 25-second ceiling on /middleware, and a killed middleware is not a slow
 *  page: the visitor gets a platform error page instead of the ERP.
 *
 *  It is not a slow query. staff_access() is 5ms against this database,
 *  measured. It is a stalled round-trip — a cold auth server, a lost packet —
 *  and the only thing that makes it a 25-second outage rather than a blip is
 *  the absence of a deadline.
 *
 *  FAILS CLOSED, AND THAT IS NOT A STYLE CHOICE. 70 of the 180 ERP pages have
 *  no server-side guard of their own; for them this middleware is the whole
 *  gate. Letting a request through because the permission read timed out would
 *  serve the Users screen, the Ledger and the Approval Inbox to whoever asked.
 *  So a timeout answers 503 — it never continues and never redirects, because a
 *  redirect to any ERP page comes straight back here and loops. */
const TIMEOUT_MS = 8000;

class Stalled extends Error {}

async function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Stalled(what)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** What a visitor gets instead of a hang. Plain HTML: this runs on the edge and
 *  cannot render a React page, and no-store because the next request may well
 *  succeed. */
function unavailable(what: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>VISTAERP — one moment</title>`
    + `<div style="font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:15vh auto;padding:0 1.5rem;color:#334155">`
    + `<h1 style="font-size:1.25rem;margin:0 0 .5rem">Signing you in is taking too long</h1>`
    + `<p style="margin:0 0 1rem">The ERP could not confirm your access just now (${what}). `
    + `Nothing has been changed. Please try again.</p>`
    + `<p><a href="" onclick="location.reload();return false" style="color:#0f766e;font-weight:600">Try again</a></p>`
    + `</div>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function requiredPerms(path: string): string[] | null {
  let best: string[] | null = null; let bestLen = -1;
  for (const [prefix, perms] of ROUTE_PERMS) {
    if ((path === prefix || path.startsWith(prefix + "/")) && prefix.length > bestLen) {
      best = perms; bestLen = prefix.length;
    }
  }
  return best;
}


export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // The B2B agent and Transport vendor portals (and their APIs) run on their own
  // cookie sessions and never need staff Supabase auth. Short-circuit here so we
  // skip the auth-server round-trip for every navigation inside those portals.
  //
  // The last two are not browsed by anybody — they are called by machines that
  // have no Supabase session and never will: pg_net, when a notification row is
  // inserted, and the scheduler. Without them here the guard below sent both to
  // /login, which is a page and answers a POST with 405 — so every push since
  // the feature was built was redirected instead of delivered, and neither cron
  // job ever reached its own body. Each carries its own secret and checks it
  // before doing anything (push_dispatch_targets takes p_secret; the cron routes
  // require CRON_SECRET), which is what makes them safe to let past staff auth.
  const p0 = request.nextUrl.pathname;
  if (p0.startsWith("/agent") || p0.startsWith("/api/agent") || p0.startsWith("/vendor") || p0.startsWith("/api/vendor")
      || p0.startsWith("/driver") || p0.startsWith("/api/driver")
      || p0.startsWith("/v/") || p0.startsWith("/hv/")
      || p0 === "/api/push/dispatch" || p0.startsWith("/api/cron/")) {
    // /v/ = public transport voucher, /hv/ = public hotel voucher (shared via QR).
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user: { id: string } | null = null;
  try {
    const { data } = await withDeadline(supabase.auth.getUser(), "the sign-in check");
    user = (data?.user ?? null) as { id: string } | null;
  } catch (e) {
    if (e instanceof Stalled) return unavailable(e.message);
    throw e;
  }

  const path = request.nextUrl.pathname;

  // Self-registration has been removed — accounts are created only by Vista
  // Group administrators. Any hit to the old signup route lands on the login.
  if (path === "/signup" || path.startsWith("/signup/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // /portal was a half-built second agent portal, reading tables the live one
  // does not use. The agent portal is /agent; old bookmarks land there rather
  // than on a 404.
  if (path === "/portal" || path.startsWith("/portal/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/agent";
    return NextResponse.redirect(url);
  }

  // The Customers / Agents / Suppliers screen was folded into the Chart of
  // Accounts: an account says what it is, and the party record is created,
  // edited and deleted with it. Old bookmarks land on the tree.
  if (path === "/parties" || path.startsWith("/parties/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/accounting/accounts";
    return NextResponse.redirect(url);
  }

  // The ERP root always opens the login screen (or the dashboard when the
  // staff user is already signed in).
  if (path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = user ? "/dashboard" : "/login";
    return NextResponse.redirect(url);
  }

  const isAuthRoute = path.startsWith("/login");
  // The B2B agent and Transport vendor portals have their own sessions and must
  // not be gated by staff Supabase auth.
  const isAgentPortal = path.startsWith("/agent") || path.startsWith("/api/agent");
  const isVendorPortal = path.startsWith("/vendor") || path.startsWith("/api/vendor");
  const isPublic = isAuthRoute || isAgentPortal || isVendorPortal;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Access enforcement for staff pages, in one place rather than page by page:
  //   1. the login window / blocked account  -> /locked
  //   2. the module permission for the route  -> somewhere they can go
  //   3. the screen's own "Access" right      -> somewhere they can go
  // Skips API/agent/auth routes, the two pages a shut-out user must reach, and
  // asset requests (manifest, service worker, .txt): those used to cost nothing
  // because they are not permission-gated, and must not now cost a round-trip
  // each. A path whose last segment has a dot is a file, not a screen.
  const isAsset = path.slice(path.lastIndexOf("/")).includes(".");
  if (user && !isAgentPortal && !isVendorPortal && !isAuthRoute && !path.startsWith("/api")
      && !isAsset && path !== "/no-access" && path !== "/locked") {
    let data: any;
    try {
      // Wrapped in Promise.resolve: a PostgrestFilterBuilder is thenable but not
      // a Promise, and Promise.race only accepts the latter.
      const r = await withDeadline(Promise.resolve(supabase.rpc("staff_access")), "the permission check");
      data = r.data;
    } catch (e) {
      if (e instanceof Stalled) return unavailable(e.message);
      throw e;
    }
    const isAdmin = !!(data as any)?.is_admin;
    const perms = ((data as any)?.permissions ?? {}) as Record<string, boolean>;
    const docRights = ((data as any)?.doc_rights ?? {}) as DocRightsMap;
    const unrestricted = isAdmin || Object.keys(perms).length === 0;

    if ((data as any)?.login_ok === false) {
      const url = request.nextUrl.clone();
      url.pathname = "/locked";
      return NextResponse.redirect(url);
    }

    // Where to send someone who may not be here. It must be somewhere they can
    // actually open, or the redirect bounces back and the browser loops: the
    // landing page is chosen from module permissions and can itself be a screen
    // their Access rights withhold.
    const sendAway = () => {
      const dest = unrestricted || perms["dashboard.view"] ? "/dashboard" : landingFor(perms);
      const destDoc = docForPath(dest);
      const reachable = dest !== path && (!destDoc || hasDocRight(docRights, isAdmin, destDoc, "access"));
      const url = request.nextUrl.clone();
      url.pathname = reachable ? dest : "/no-access";
      return NextResponse.redirect(url);
    };

    // The user-administration routes never pass on an empty permissions map:
    // see staff_perm_strict() in the database, which the RPCs behind them use.
    // Admins still pass everything.
    const strictRoute = ["/settings/users", "/settings/roles", "/settings/agents"]
      .some((r) => path === r || path.startsWith(r + "/"));
    const required = requiredPerms(path);
    if (required) {
      const holdsOne = required.some((k) => perms[k]);
      const nothingSet = Object.keys(perms).length === 0;
      const allowed = isAdmin || holdsOne || (nothingSet && !strictRoute);
      if (!allowed) return sendAway();
    }

    const doc = docForPath(path);
    if (doc && !hasDocRight(docRights, isAdmin, doc, "access")) return sendAway();
  }

  return response;
}
