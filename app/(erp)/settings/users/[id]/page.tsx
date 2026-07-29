import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import EditUserRoles from "./EditUserRoles";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: rows } = await supabase.rpc("staff_users_list", { p_id: params.id });
  const profile = (rows as any[])?.[0] ?? null;

  if (!profile) notFound();

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", params.id);

  const currentRoles = (roles ?? []).map((r: any) => r.role);
  const p = profile as any;

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold">{p.full_name ?? "User"}</h1>
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
      />
    </div>
  );
}
