import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function NoAccessPage() {
  return (
    <div className="max-w-lg">
      <PageHeader title="No Access" />
      <div className="card text-sm text-slate-600">
        <p>Your account doesn’t have access to any modules yet.</p>
        <p className="mt-2 text-slate-500">Please contact your Vista Group administrator to have the right permissions assigned.</p>
      </div>
    </div>
  );
}
