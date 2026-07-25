import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyRecommendation from "@/components/CompanyRecommendation";

export const dynamic = "force-dynamic";

export default async function CompanyRecommendationPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user?.id ?? "");
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");

  return (
    <div className="space-y-6">
      <PageHeader title="Company Recommendation" />
      <p className="text-sm text-slate-500">
        Before creating a group in Nusuk Masar, check which company to select based on current BRN availability across all companies. Reserve a company to hold it while you create the group.
      </p>
      <CompanyRecommendation endpoint="/api/recommendation" canConfig={isAdmin} canRelease />
    </div>
  );
}
