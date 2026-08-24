import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

const ACTION_BADGE: Record<string, string> = {
  posted: "bg-green-100 text-green-700", submitted: "bg-amber-100 text-amber-700",
  authorized: "bg-green-100 text-green-700", approval: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700", cancelled: "bg-slate-200 text-slate-600",
};

export default async function AuditPage() {
  const sb = createClient();
  const { data } = await sb.from("acct_audit")
    .select("action, doc_type, ref, detail, at, profiles(full_name, email)")
    .order("at", { ascending: false }).limit(300);
  const rows = (data ?? []) as any[];

  return (
    <div className="space-y-4">
      <PageHeader title="Audit Trail" />
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-left">Document</th><th className="px-3 py-2 text-left">Ref</th><th className="px-3 py-2 text-left">By</th><th className="px-3 py-2 text-left">Detail</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{new Date(r.at).toLocaleString()}</td>
                <td className="px-3 py-1.5"><span className={`badge ${ACTION_BADGE[r.action] ?? "bg-slate-100 text-slate-600"}`}>{r.action}</span></td>
                <td className="px-3 py-1.5">{r.doc_type}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.ref}</td>
                <td className="px-3 py-1.5">{r.profiles?.full_name ?? r.profiles?.email ?? "—"}</td>
                <td className="px-3 py-1.5 text-xs text-slate-500">{r.detail ? JSON.stringify(r.detail) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="px-3 py-6 text-center text-slate-400" colSpan={6}>No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
