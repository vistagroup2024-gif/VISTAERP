import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Route -> permissions that grant access (any-of). Longest matching prefix wins.
// Unlisted routes are not permission-gated. Mirrors the sidebar gating.
const ROUTE_PERMS: [string, string[]][] = [
  ["/dashboard", ["dashboard.view"]],
  ["/groups", ["visa.view"]],
  ["/inventory", ["brn.view", "brn.planning", "visa.view"]],
  ["/bookings", ["sales.view"]],
  ["/sales", ["sales.view"]],
  ["/packages", ["sales.view"]],
  ["/invoices", ["sales.view"]],
  ["/parties", ["sales.view"]],
  ["/hotels", ["hotels.masters", "hotels.bookings", "hotels.suppliers"]],
  ["/allotments", ["hotels.masters", "hotels.bookings"]],
  ["/transport", ["transport.masters", "transport.bookings", "transport.operations", "transport.vehicles", "transport.reports", "transport.driver_assign", "transport.trip_ledger"]],
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
  ["brn.view", "/inventory"],
  ["transport.bookings", "/transport"], ["transport.operations", "/transport"],
  ["transport.masters", "/transport"], ["transport.vehicles", "/transport"], ["transport.reports", "/transport"], ["transport.trip_ledger", "/transport/reports/ledger"],
  ["hotels.bookings", "/hotels"], ["hotels.masters", "/hotels"],
  ["sales.view", "/bookings"],
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
      || p0.startsWith("/v/")) {
    // /v/ is the public, login-free transport voucher (shared via QR).
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

  // Permission enforcement for staff pages: a restricted user can only open the
  // modules they're granted. Skips API/agent/auth routes and the /no-access page.
  // Admins and not-yet-restricted accounts (no permissions set) pass everything.
  if (user && !isAgentPortal && !isVendorPortal && !isAuthRoute && !path.startsWith("/api") && path !== "/no-access") {
    const required = requiredPerms(path);
    if (required) {
      const { data } = await supabase.rpc("staff_access");
      const isAdmin = !!(data as any)?.is_admin;
      const perms = ((data as any)?.permissions ?? {}) as Record<string, boolean>;
      const unrestricted = isAdmin || Object.keys(perms).length === 0;
      if (!unrestricted && !required.some((k) => perms[k])) {
        const url = request.nextUrl.clone();
        url.pathname = landingFor(perms);
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}
