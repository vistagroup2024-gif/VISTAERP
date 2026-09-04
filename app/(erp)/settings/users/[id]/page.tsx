import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import EditUserRoles from "./EditUserRoles";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: rows } = await supabase.rpc("staff_users_list", { p_id: params.id });
  const profile = (rows as any[])?.[0] ?? null;

  if (!profile) notFound();

  // The four master trees the Restrict tab picks from, and the user's current
  // restrictions / rights / login window. Loaded here as the admin viewing the
  // page, so the picker shows the whole tree even when the user being edited is
  // restricted to a corner of it.
  const [{ data: roles }, { data: access }, { data: trees }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", params.id),
    supabase.rpc("staff_user_access", { p_id: params.id }),
    // Whole trees, not the ones the viewer may touch: a user manager who is
    // himself restricted must still see the entire list he is editing, or
    // saving would write back a partial one as if it were complete.
    supabase.rpc("staff_scope_masters"),
  ]);
  const t = (trees as any) ?? {};

  const currentRoles = (roles ?? []).map((r: any) => r.role);
  const p = profile as any;
  const a = (access as any) ?? {};
  // staff_user_access only answers a caller holding users.manage_roles. Without
  // it the Restrict / Access / Modules tabs would show an empty user and saving
  // would fail after the profile edit had already gone through, so they are not
  // offered at all.
  const canManageAccess = access != null;

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-xl font-bold tracking-tight text-slate-900">{p.full_name ?? "User"}</h1>
      <p className="mb-6 text-sm text-slate-500">
        Login ID: <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700">{p.username}</span>
      </p>
      <EditUserRoles
        userId={params.id}
        fullName={p.full_name ?? ""}
        isActive={p.is_active}
        email={p.email ?? ""}
        phone={p.phone ?? ""}
        department={p.department ?? ""}
        designation={p.designation ?? ""}
        currentPerms={p.permissions ?? {}}
        currentRoles={currentRoles}
        canManageAccess={canManageAccess}
        docRights={a.doc_rights ?? {}}
        scopes={a.scopes ?? {}}
        scopeExclude={a.scope_exclude ?? {}}
        dashboardCards={a.dashboard_cards ?? {}}
        loginDateFrom={a.login_date_from ?? ""}
        loginDateTo={a.login_date_to ?? ""}
        loginTimeFrom={a.login_time_from ?? ""}
        loginTimeTo={a.login_time_to ?? ""}
        masters={{
          account: t.account ?? [],
          product: t.product ?? [],
          cost_center: t.cost_center ?? [],
          tag_area: t.tag_area ?? [],
        }}
      />
    </div>
  );
}
