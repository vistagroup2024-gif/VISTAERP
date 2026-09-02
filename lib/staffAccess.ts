// ============================================================
// The permission decision itself, with no Next.js or Supabase attached.
//
// staffSession.ts loads a user's access (which needs cookies, a Supabase
// client and React's cache) and re-exports these. This file is only the RULE,
// so it can be imported anywhere — including by a plain script that checks the
// permission matrix without booting the framework.
//
// The rule has one wrinkle worth stating out loud: an account with NO granular
// permissions set is treated as unrestricted. That is deliberate backwards
// compatibility with the role-only accounts that predate the permission map —
// but it means a brand-new empty account is not locked down by default, and
// anything relying on this must be aware of it.
// ============================================================

export interface StaffAccess {
  isAdmin: boolean;
  permissions: Record<string, boolean>;
  fullName: string | null;
  /** True when no granular permissions are set — treated as full access. */
  unrestricted: boolean;
}

/** Menu/page/action gate. Mirrors the DB's staff_has_perm() exactly. */
export function staffCan(access: StaffAccess, key: string): boolean {
  if (access.unrestricted) return true;
  return !!access.permissions[key];
}
