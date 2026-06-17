import Link from "next/link";

export default function PortalBook() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-2xl font-bold text-brand-dark">Create a booking request</h1>
      <div className="card text-sm text-slate-600">
        <p>
          Self-service agent booking is part of the B2B portal roadmap. For now,
          browse available packages on your dashboard and your assigned account
          manager will confirm allotment and pricing.
        </p>
        <p className="mt-3">
          The data model already supports agent-created bookings (RLS policy
          <code> bookings_agent_insert</code>); the guided booking form will be
          wired up in the next portal iteration.
        </p>
      </div>
      <Link href="/portal" className="btn-outline">← Back to portal</Link>
    </main>
  );
}
