import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import CompanyFilter from "@/components/CompanyFilter";
import { dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PackageHistoryPage({ searchParams }: { searchParams: { company?: string } }) {
  const company = searchParams.company ?? "";
  const supabase = createClient();
  const [{ data: rows }, { data: companies }] = await Promise.all([
    supabase.from("package_update_history").select("*").order("updated_at", { ascending: false }).limit(1000),
    supabase.from("group_companies").select("id, name").order("name"),
  ]);

  const H = (rows ?? []).filter((r: any) => !company || r.company_name === (companies ?? []).find((c: any) => c.id === company)?.name);

  return (
    <div>
      <PageHeader title="Package Update History" />
      <CompanyFilter companies={companies ?? []} value={company} />
      <p className="mb-4 text-sm text-slate-500">Audit trail of every package completed in Nusuk (Mark Package Updated).</p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1080px]">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Group No</th>
              <th className="th">Company</th>
              <th className="th">Agent</th>
              <th className="th">Arrival</th>
              <th className="th">Departure</th>
              <th className="th">Previous BRNs</th>
              <th className="th">Newly Added BRNs</th>
              <th className="th">Updated At</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {H.map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="td font-mono font-medium">
                  {r.group_id ? <Link href={`/groups/${r.group_id}`} className="text-brand hover:underline">{r.group_no}</Link> : r.group_no}
                </td>
                <td className="td text-slate-500">{r.company_name ?? "—"}</td>
                <td className="td text-slate-500">{r.agent_name ?? "—"}</td>
                <td className="td text-sm">{dateStr(r.arrival_date)}</td>
                <td className="td text-sm">{dateStr(r.departure_date)}</td>
                <td className="td text-sm">{r.prev_brns ?? "—"}</td>
                <td className="td text-sm text-teal-700">{r.new_brns ?? "—"}</td>
                <td className="td text-sm text-slate-500">{new Date(r.updated_at).toLocaleString()}</td>
                <td className="td"><span className="badge bg-blue-100 text-blue-700">Package Updated</span></td>
              </tr>
            ))}
            {H.length === 0 && <tr><td className="td text-slate-400" colSpan={9}>No package updates recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
