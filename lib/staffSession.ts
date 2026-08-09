import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface StaffAccess {
  isAdmin: boolean;
  permissions: Record<string, boolean>;
  fullName: string | null;
  // True when no granular permissions have been assigned yet — treated as
  // full access for backward compatibility with role-only staff accounts.
  unrestricted: boolean;
}

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

// Cached current user (auth.getUser validates the JWT with the auth server; this
// dedupes it across the layout and any page that also needs the user in one render).
export const getSessionUser = cache(async function getSessionUser() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user;
});

// Menu/page/action gate. Admins and not-yet-restricted accounts pass everything;
// otherwise the specific permission must be granted.
export function staffCan(access: StaffAccess, key: string): boolean {
  if (access.unrestricted) return true;
  return !!access.permissions[key];
}

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
  ["sales.view", "/bookings"],
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
