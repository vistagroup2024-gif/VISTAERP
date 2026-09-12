import PageHeader from "@/components/PageHeader";
import NotificationSettings from "@/components/NotificationSettings";
import NotificationPicker from "@/components/NotificationPicker";

export const dynamic = "force-dynamic";

// Two separate questions on one screen, in the order they matter:
//   WHICH notifications do you want   — a preference, per user, saved server-side
//                                       because the phone push is dispatched there
//   HOW do they reach you             — devices, tone, volume
export default function NotificationsSettingsPage() {
  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader title="Notifications" />

      <NotificationPicker />

      <div className="space-y-4 border-t border-slate-200 pt-6">
        <h3 className="font-semibold text-slate-800">How they reach you</h3>
        <p className="text-sm text-slate-500">
          Turn on phone notifications to get alerts even when the ERP is closed. You can register more
          than one device. Only the notifications you chose above are sent.
        </p>
        <NotificationSettings endpoint="/api/push" />
      </div>
    </div>
  );
}
