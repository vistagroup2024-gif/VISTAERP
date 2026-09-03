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
  const [{ data: roles }, { data: access }, accounts, products, costCenters, tagAreas] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", params.id),
    supabase.rpc("staff_user_access", { p_id: params.id }),
    supabase.from("accounts").select("id, name, code, parent_id, is_group").order("code"),
    supabase.from("acct_products").select("id, name, parent_id, is_group").order("name"),
    supabase.from("acct_cost_centers").select("id, name, code, parent_id, is_group").order("name"),
    supabase.from("acct_tag_areas").select("id, name, parent_id, is_group").order("name"),
  ]);

  const currentRoles = (roles ?? []).map((r: any) => r.role);
  const p = profile as any;
  const a = (access as any) ?? {};

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
        docRights={a.doc_rights ?? {}}
        scopes={a.scopes ?? {}}
        scopeExclude={a.scope_exclude ?? {}}
        loginDateFrom={a.login_date_from ?? ""}
        loginDateTo={a.login_date_to ?? ""}
        loginTimeFrom={a.login_time_from ?? ""}
        loginTimeTo={a.login_time_to ?? ""}
        masters={{
          account: (accounts.data as any[]) ?? [],
          product: (products.data as any[]) ?? [],
          cost_center: (costCenters.data as any[]) ?? [],
          tag_area: (tagAreas.data as any[]) ?? [],
        }}
      />
    </div>
  );
}
