import PageHeader from "@/components/PageHeader";
import NotificationSettings from "@/components/NotificationSettings";

export const dynamic = "force-dynamic";

export default function NotificationsSettingsPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Notifications" />
      <p className="text-sm text-slate-500">Turn on phone notifications to get alerts (approvals, arrivals, payments, tasks) even when the ERP is closed. You can register more than one device.</p>
      <NotificationSettings endpoint="/api/push" />
    </div>
  );
}
