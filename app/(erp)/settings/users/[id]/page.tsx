import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import EditUserRoles from "./EditUserRoles";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: profile } = await supabase
    .from("staff_users")
    .select("id, full_name, username, is_active")
    .eq("id", params.id)
    .single();

  if (!profile) notFound();

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", params.id);

  const currentRoles = (roles ?? []).map((r: any) => r.role);

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 text-2xl font-bold">{profile.full_name ?? "User"}</h1>
      <p className="mb-6 text-sm text-slate-500">
        Login ID: <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-slate-700">{(profile as any).username}</span>
      </p>
      <EditUserRoles
        userId={params.id}
        fullName={profile.full_name ?? ""}
        isActive={profile.is_active}
        currentRoles={currentRoles}
      />
    </div>
  );
}
