import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { docForPath, hasDocRight, type DocRightsMap } from "@/lib/docRights";

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
  ["/parties", ["sales.view", "parties.manage"]],
  ["/hotels", ["hotels.masters", "hotels.bookings", "hotels.suppliers", "hotels.hcn", "hotels.reports", "hotels.purchase"]],
  ["/allotments", ["hotels.masters", "hotels.bookings"]],
  ["/transport", ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.reports", "transport.driver_assign", "transport.trip_ledger"]],
  ["/car-sales", ["carsales.view", "carsales.vehicles", "carsales.sales", "carsales.installments", "carsales.receipts", "carsales.charges", "carsales.ownership", "carsales.reports", "carsales.accounting"]],
  ["/purchase", ["purchase.view"]],
  ["/accounting", ["accounting.view"]],
  ["/settings/users", ["users.view"]],
  ["/settings/roles", ["users.view", "users.manage_roles"]],
  ["/settings/agents", ["users.view"]],
  ["/settings/companies", ["system.companies", "system.config", "system.masters"]],
];

// First accessible module for a restricted user (priority order), else /no-access.
const LANDING: [string, string][] = [
  ["dashboard.view", "/dashboard"],
  ["visa.view", "/groups"],
  ["visa.invoices", "/visa/invoices"],
  ["brn.view", "/inventory/brn"],
  ["transport.bookings", "/transport/bookings"], ["transport.operations", "/transport/operations"],
  ["transport.masters", "/transport/routes"], ["transport.vehicles", "/transport/vehicles"], ["transport.reports", "/transport/reports"], ["transport.trip_ledger", "/transport/reports/ledger"],
  ["hotels.bookings", "/hotels"], ["hotels.masters", "/hotels"],
  ["carsales.view", "/car-sales/vehicles"], ["carsales.reports", "/car-sales/reports"], ["carsales.vehicles", "/car-sales/vehicles"],
  ["sales.view", "/invoices"],
  ["parties.manage", "/parties"],
  ["accounting.view", "/accounting/accounts"],
  ["purchase.view", "/purchase/bills"],
  ["users.view", "/settings/users"],
];

function requiredPerms(path: string): string[] | null {
  let best: string[] | null = null; let bestLen = -1;
  for (const [prefix, perms] of ROUTE_PERMS) {
    if ((path === prefix || path.startsWith(prefix + "/")) && prefix.length > bestLen) {
      best = perms; bestLen = prefix.length;
    }
  }
  return best;
}

function landingFor(perms: Record<string, boolean>): string {
  for (const [key, dest] of LANDING) if (perms[key]) return dest;
  return "/no-access";
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // The B2B agent and Transport vendor portals (and their APIs) run on their own
  // cookie sessions and never need staff Supabase auth. Short-circuit here so we
  // skip the auth-server round-trip for every navigation inside those portals.
  const p0 = request.nextUrl.pathname;
  if (p0.startsWith("/agent") || p0.startsWith("/api/agent") || p0.startsWith("/vendor") || p0.startsWith("/api/vendor")
      || p0.startsWith("/driver") || p0.startsWith("/api/driver")
      || p0.startsWith("/v/") || p0.startsWith("/hv/")) {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Self-registration has been removed — accounts are created only by Vista
  // Group administrators. Any hit to the old signup route lands on the login.
  if (path === "/signup" || path.startsWith("/signup/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
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
    const { data } = await supabase.rpc("staff_access");
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
