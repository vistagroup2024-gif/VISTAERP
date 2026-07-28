import { createClient } from "@/lib/supabase/server";

export interface StaffAccess {
  isAdmin: boolean;
  permissions: Record<string, boolean>;
  // True when no granular permissions have been assigned yet — treated as
  // full access for backward compatibility with role-only staff accounts.
  unrestricted: boolean;
}

// Loads the current staff user's access (admin flag + granular permission map).
export async function getStaffAccess(): Promise<StaffAccess> {
  const sb = createClient();
  const { data } = await sb.rpc("staff_access");
  const isAdmin = !!(data as any)?.is_admin;
  const permissions = ((data as any)?.permissions ?? {}) as Record<string, boolean>;
  const unrestricted = isAdmin || Object.keys(permissions).length === 0;
  return { isAdmin, permissions, unrestricted };
}

// Menu/page/action gate. Admins and not-yet-restricted accounts pass everything;
// otherwise the specific permission must be granted.
export function staffCan(access: StaffAccess, key: string): boolean {
  if (access.unrestricted) return true;
  return !!access.permissions[key];
}
