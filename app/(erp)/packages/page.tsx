import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import { dateStr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PackagesPage() {
  const supabase = createClient();
  const { data: packages } = await supabase
    .from("packages")
    .select("id, name, code, duration_days, status, valid_from, valid_to, base_currency")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader title="Packages" action={{ href: "/packages/new", label: "+ New Package" }} />
      <div className="card overflow-hidden p-0">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Package</th>
              <th className="th">Code</th>
              <th className="th">Duration</th>
              <th className="th">Validity</th>
              <th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {(packages ?? []).map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="td font-medium">
                  <Link href={`/packages/${p.id}`} className="text-brand hover:underline">{p.name}</Link>
                </td>
                <td className="td">{p.code ?? "—"}</td>
                <td className="td">{p.duration_days ? `${p.duration_days} days` : "—"}</td>
                <td className="td">{dateStr(p.valid_from)} – {dateStr(p.valid_to)}</td>
                <td className="td">
                  <span className={`badge ${p.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{p.status}</span>
                </td>
              </tr>
            ))}
            {(packages ?? []).length === 0 && (
              <tr><td className="td text-slate-400" colSpan={5}>No packages yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
