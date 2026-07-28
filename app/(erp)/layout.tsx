import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import { getStaffAccess } from "@/lib/staffSession";

export default async function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const access = await getStaffAccess();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        name={profile?.full_name || user.email || "User"}
        access={{ unrestricted: access.unrestricted, permissions: access.permissions }}
      />
      <main className="flex-1 overflow-x-hidden p-4 pt-18 lg:p-8 lg:pt-8">{children}</main>
    </div>
  );
}
