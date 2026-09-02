import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { staffCan, type StaffAccess } from "@/lib/staffAccess";

// The permission rule and its type live in lib/staffAccess.ts, which carries no
// Next.js or Supabase imports so it can be checked outside the framework. They
// are re-exported here so every existing import keeps working unchanged.
export { staffCan };
export type { StaffAccess };

// Loads the current staff user's access (admin flag + granular permission map).
// Wrapped in React cache() so the layout guard and every page's guardStaffPage
// share ONE staff_access round-trip per request instead of repeating it.
export const getStaffAccess = cache(async function getStaffAccess(): Promise<StaffAccess> {
  const sb = createClient();
  const { data } = await sb.rpc("staff_access");
  const isAdmin = !!(data as any)?.is_admin;
  const permissions = ((data as any)?.permissions ?? {}) as Record<string, boolean>;
  const fullName = ((data as any)?.full_name ?? null) as string | null;
  const unrestricted = isAdmin || Object.keys(permissions).length === 0;
  return { isAdmin, permissions, fullName, unrestricted };
});

// Cached current user. The middleware already calls auth.getUser() on every request
// (validating + refreshing the JWT with the auth server), so here we read the session
// from the cookie LOCALLY — no extra auth-server round-trip per page — and rely on the
// DB's row-level security (which validates the JWT itself) for data protection.
export const getSessionUser = cache(async function getSessionUser() {
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  return session?.user ?? null;
});

// First module a user can land on, in priority order. Used to route a restricted
// user away from a page they can't see (e.g. the Dashboard).
const LANDING: [string, string][] = [
  ["dashboard.view", "/dashboard"],
  ["visa.view", "/groups"],
  ["brn.view", "/inventory"],
  ["transport.bookings", "/transport"],
  ["transport.operations", "/transport"],
  ["transport.masters", "/transport"],
  ["transport.vehicles", "/transport"],
  ["transport.reports", "/transport"],
  ["hotels.bookings", "/hotels"],
  ["hotels.masters", "/hotels"],
  ["sales.view", "/invoices"],
  ["accounting.view", "/accounting/accounts"],
  ["purchase.view", "/purchase/bills"],
  ["users.view", "/settings/users"],
];

// Server-page guard: loads access and redirects users lacking `key` to their
// landing page, so a page can't be reached by URL even if the nav hides it.
export async function guardStaffPage(key: string | string[]): Promise<StaffAccess> {
  const access = await getStaffAccess();
  const keys = Array.isArray(key) ? key : [key];
  if (!keys.some((k) => staffCan(access, k))) redirect(staffLanding(access));
  return access;
}

export function staffLanding(access: StaffAccess): string {
  if (access.unrestricted) return "/dashboard";
  for (const [key, path] of LANDING) if (access.permissions[key]) return path;
  return "/no-access";
}
