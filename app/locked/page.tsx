import { createClient } from "@/lib/supabase/server";
import { getStaffAccess } from "@/lib/staffSession";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function hhmm(t: string | null) { return t ? t.slice(0, 5) : null; }

// Shown when a staff account is blocked, or the clock is outside the login
// window an admin set for them. The database has already closed with them —
// is_staff() is false — so there is nothing to see behind this page.
export default async function LockedPage() {
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) redirect("/login");

  const access = await getStaffAccess();
  if (access.loginOk) redirect("/dashboard");

  const w = access.loginWindow;
  const from = hhmm(w?.time_from ?? null), to = hhmm(w?.time_to ?? null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="card max-w-md space-y-4 text-center">
        <div className="text-4xl">🔒</div>
        <h1 className="text-lg font-semibold text-slate-800">Outside your access hours</h1>
        <p className="text-sm text-slate-600">
          This account can only be used during the hours set for it. Please try again
          inside your window, or ask an administrator to change it.
        </p>
        <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {from && to
            ? <div><span className="text-slate-500">Daily hours</span> · <span className="font-medium">{from} – {to}</span></div>
            : null}
          {w?.date_from || w?.date_to
            ? <div className="mt-1"><span className="text-slate-500">Valid</span>{" "}
                <span className="font-medium">{w.date_from ?? "—"} to {w.date_to ?? "—"}</span></div>
            : null}
          {!from && !to && !w?.date_from && !w?.date_to
            ? <span className="text-slate-500">This account has been blocked.</span> : null}
        </div>
        <Link href="/login" className="btn-outline inline-block text-sm">Back to sign in</Link>
      </div>
    </div>
  );
}
