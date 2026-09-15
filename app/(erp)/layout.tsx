import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Suspense } from "react";
import { AccessProvider } from "@/components/AccessProvider";
import NavButtons from "@/components/NavButtons";
import TabShell from "@/components/shell/TabShell";
import EmbedBridge from "@/components/shell/EmbedBridge";
import { getSessionUser, getStaffAccess } from "@/lib/staffSession";

export default async function ErpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Both calls are React-cached, so they are shared (not repeated) with the page's
  // own guardStaffPage. The name now comes from staff_access — no extra profiles query.
  const [user, access] = await Promise.all([getSessionUser(), getStaffAccess()]);
  if (!user) redirect("/login");
  // Blocked account, or outside the login window set for this user. The database
  // has already closed too, so every page behind here would render empty.
  if (!access.loginOk) redirect("/locked");

  // Two very different things render behind this one layout, told apart by a
  // header the middleware sets (a layout gets no searchParams of its own):
  //
  //  - a TAB's own content — no sidebar, no header, no second Home/Back row,
  //    since those belong to the shell that is already drawn once around
  //    every tab, not to each one individually. EmbedBridge is what keeps
  //    this tab's label and address current in the shell as it navigates.
  //  - the SHELL itself — Sidebar, the header and the tab strip, with one
  //    hidden iframe per open tab so switching between them never loses
  //    what was on one.
  const h = headers();
  const embed = h.get("x-erp-embed") === "1";
  const navAccess = { unrestricted: access.unrestricted, permissions: access.permissions, isAdmin: access.isAdmin, docRights: access.docRights };
  const displayName = access.fullName || user.email || "User";

  if (embed) {
    return (
      <AccessProvider value={{ isAdmin: access.isAdmin, docRights: access.docRights }}>
        <Suspense fallback={null}><EmbedBridge tabId={h.get("x-erp-tab") ?? ""} /></Suspense>
        <main className="min-w-0 p-4 lg:p-8">
          {/* Back and Home for EVERY screen, drawn once per tab rather than by
              each page. Putting it in PageHeader covered the 137 screens that
              use one and missed 46 that draw their own title bar; putting it
              here covers all of them, and no page can show a second pair
              because no page renders it. Home switches the SHELL to its
              pinned Home tab rather than navigating this tab away from
              whatever it is showing. */}
          <div className="no-print mb-3"><NavButtons /></div>
          {children}
        </main>
      </AccessProvider>
    );
  }

  return <TabShell name={displayName} access={navAccess} initialPath={h.get("x-erp-path") ?? "/dashboard"} />;
}
