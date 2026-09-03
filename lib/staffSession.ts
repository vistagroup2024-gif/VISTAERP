import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ALL_DOC_RIGHTS, hasDocRight, type DocRight, type DocRightsMap } from "@/lib/docRights";

export interface LoginWindow {
  date_from: string | null; date_to: string | null;
  time_from: string | null; time_to: string | null;
}

export interface StaffAccess {
  isAdmin: boolean;
  permissions: Record<string, boolean>;
  fullName: string | null;
  // True when no granular permissions have been assigned yet — treated as
  // full access for backward compatibility with role-only staff accounts.
  unrestricted: boolean;
  // Per-screen rights (Access tab). Empty map = every screen, every right.
  docRights: DocRightsMap;
  // False when the account is blocked or the clock is outside the user's login
  // window. The database enforces this too — is_staff() goes false with it —
  // so this is for showing the reason, not for being the only thing in the way.
  loginOk: boolean;
  loginWindow: LoginWindow | null;
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
  const docRights = ((data as any)?.doc_rights ?? {}) as DocRightsMap;
  const loginOk = (data as any)?.login_ok !== false;
  const loginWindow = ((data as any)?.login_window ?? null) as LoginWindow | null;
  return { isAdmin, permissions, fullName, unrestricted, docRights, loginOk, loginWindow };
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

// Menu/page/action gate. Admins and not-yet-restricted accounts pass everything;
// otherwise the specific permission must be granted.
export function staffCan(access: StaffAccess, key: string): boolean {
  if (access.unrestricted) return true;
  return !!access.permissions[key];
}

// Screen-level right (Access tab): can this user open / enter / change / delete
// / print this particular voucher or report.
export function staffDocCan(access: StaffAccess, doc: string, right: DocRight): boolean {
  return hasDocRight(access.docRights, access.isAdmin, doc, right);
}

// The resolved rights for one screen, as a plain object a server page can hand
// to a client voucher component (functions don't cross that boundary, values do).
export function docRightsFor(access: StaffAccess, doc: string): Record<DocRight, boolean> {
  return Object.fromEntries(ALL_DOC_RIGHTS.map((r) => [r, staffDocCan(access, doc, r)])) as Record<DocRight, boolean>;
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
  ["sales.view", "/invoices"],
  ["accounting.view", "/accounting/accounts"],
  ["purchase.view", "/purchase/bills"],
  ["users.view", "/settings/users"],
];

// Server-page guard: loads access and redirects users lacking `key` to their
// landing page, so a page can't be reached by URL even if the nav hides it.
export async function guardStaffPage(key: string | string[], doc?: string): Promise<StaffAccess> {
  const access = await getStaffAccess();
  const keys = Array.isArray(key) ? key : [key];
  if (!keys.some((k) => staffCan(access, k))) redirect(staffLanding(access));
  // A screen named in the Access tab also needs its own "Access" right.
  if (doc && !staffDocCan(access, doc, "access")) redirect(staffLanding(access));
  return access;
}

export function staffLanding(access: StaffAccess): string {
  if (access.unrestricted) return "/dashboard";
  for (const [key, path] of LANDING) if (access.permissions[key]) return path;
  return "/no-access";
}
