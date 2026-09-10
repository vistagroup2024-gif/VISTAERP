import PageHeader from "@/components/PageHeader";
import InvoiceAutomationSettings from "@/components/accounting/InvoiceAutomationSettings";
import { getStaffAccess } from "@/lib/staffSession";

export const dynamic = "force-dynamic";

// Which automatic postings run, and on which accounts. Editing is gated on
// accounting.settings (an admin always passes); everyone who can open the
// screen can read the rules, because "what will the ERP do?" is not a secret
// from the people whose work it posts.
export default async function InvoiceAutomationPage() {
  const access = await getStaffAccess();
  const canEdit = access.isAdmin || access.unrestricted || !!access.permissions?.["accounting.settings"];

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Invoice Automation" />
      <p className="text-sm text-slate-500">
        Every automatic accounting entry the ERP can make, what sets it off, and which accounts it uses.
        Nothing here posts until it is switched on.
      </p>
      {!canEdit && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          You can see these rules but not change them. Ask an administrator for the
          <b> Invoice Automation Settings</b> permission.
        </div>
      )}
      <InvoiceAutomationSettings canEdit={canEdit} />
    </div>
  );
}
