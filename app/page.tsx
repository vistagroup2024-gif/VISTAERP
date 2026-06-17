import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-4xl font-bold text-brand-dark">Vista ERP</h1>
        <p className="mt-2 max-w-md text-slate-500">
          Umrah Services &amp; Trading — Bookings, Hotels, Packages, Sales,
          Accounting, HR &amp; Inventory in one place.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/login" className="btn">
          Staff Login
        </Link>
        <Link href="/portal" className="btn-outline">
          B2B Partner Portal
        </Link>
      </div>
    </main>
  );
}
