import PageHeader from "@/components/PageHeader";
import NotificationRules from "@/components/NotificationRules";
import { guardStaffPage } from "@/lib/staffSession";

export const dynamic = "force-dynamic";

// Changing these changes what the whole company is told and when, so the right
// is strict: an admin, or somebody ticked for it by name. Everyone else with
// accounting/settings access can read them — knowing when a reminder fires is
// useful even if changing it is not yours to do.
export default async function NotificationRulesPage() {
  const access = await guardStaffPage("accounting.view");
  const canEdit = access.isAdmin || !!access.permissions?.["notifications.manage"];
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Notification Rules" />
      <NotificationRules canEdit={canEdit} />
    </div>
  );
}
