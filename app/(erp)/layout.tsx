import { Suspense } from "react";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import AppHeader from "@/components/AppHeader";
import { getSessionUser, getStaffAccess, staffCan } from "@/lib/staffSession";
import VistaAiDock from "@/components/ai/VistaAiDock";
import { aiConfigured } from "@/lib/ai/config";

export default async function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Both calls are React-cached, so they are shared (not repeated) with the page's
  // own guardStaffPage. The name now comes from staff_access — no extra profiles query.
  const [user, access] = await Promise.all([getSessionUser(), getStaffAccess()]);
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar
        name={access.fullName || user.email || "User"}
        access={{ unrestricted: access.unrestricted, permissions: access.permissions }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          name={access.fullName || user.email || "User"}
          access={{ unrestricted: access.unrestricted, permissions: access.permissions }}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 pt-18 lg:p-8 lg:pt-6">{children}</main>
      </div>
      {/* Vista AI, reachable from every screen — so "this ledger" has a
          referent. Gated on ai.use like her own page. */}
      {staffCan(access, "ai.use") && (
        <Suspense fallback={null}>
          <VistaAiDock configured={aiConfigured()} />
        </Suspense>
      )}
    </div>
  );
}
